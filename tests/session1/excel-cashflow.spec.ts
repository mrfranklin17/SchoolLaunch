import { test, expect, ACCOUNTS, loginAs, downloadCommissionExcel, readCashFlowTab, readPLRowYear } from './fixtures'
import * as path from 'path'
import * as fs from 'fs'
import * as XLSX from 'xlsx'

/**
 * Suite 3 — Commission Excel Cash Flow distribution (Fix 3; Phase 2 shared monthly model).
 *
 * The CASH FLOW tab aggregates all Y1 revenue into a single "Revenue" row (monthly totals).
 * Fix 3 changed how those monthly totals are computed — from a naive `total × OSPI%` formula
 * to a per-revenue-type distribution. Phase 2 moved that distribution into the shared
 * `computeMonthlyCashFlow()` (budgetEngine.ts), which also places custom revenue lines
 * (REVENUE rows '13.x') by group — one-time lines in September — and excludes non-cash
 * facility depreciation from the monthly Expenses row.
 *
 * What we can verify from the CASH FLOW rows:
 *  1. 12 months are present in OSPI order (Sep → Aug).
 *  2. The sum of monthly Revenue equals (within rounding) the Year 1 Total Revenue from P&L.
 *  3. The monthly shape is NOT `total * OSPI_PCT` (the old buggy behavior) — if the school has
 *     federal grants, categoricals, or food service revenue, the curve deviates from OSPI-only.
 *     We assert at least one month's value is NOT within 1% of (y1Total × OSPI_PCT).
 *  4. Σ monthly Expenses = P&L Total Expenses − Facility Depreciation (cash outflows only), and
 *     August Ending Cash reconciles with the annual Year 1 Ending Cash (engine year-end cash).
 *
 * Structural checks on the REVENUE tab confirm the per-type inputs actually exist.
 */

const ARTIFACT_DIR = path.resolve(process.cwd(), 'tests', 'session1', 'artifacts')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

const WA_MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']
const OSPI_PCTS = [9, 8, 5, 9, 8.5, 9, 9, 9, 5, 6, 12.5, 10]

function readRevenueY1ByLabel(xlsxPath: string, label: string): number | null {
  const wb = XLSX.readFile(xlsxPath)
  const sheet = wb.Sheets['REVENUE']
  if (!sheet) return null
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: true, defval: null })
  for (const r of rows) {
    const desc = r[2]
    if (typeof desc === 'string' && desc.trim().toLowerCase() === label.trim().toLowerCase()) {
      // Columns: #, Source, Description, Driver, Year 0, Year 1, ...
      const v = r[5]
      return typeof v === 'number' ? v : null
    }
  }
  return null
}

/** Custom revenue lines (REVENUE rows '13.x'): group, one-time flag (Driver column), Year 1 amount. */
function readCustomRevenueY1(xlsxPath: string): { group: string; oneTime: boolean; amount: number }[] {
  const wb = XLSX.readFile(xlsxPath)
  const sheet = wb.Sheets['REVENUE']
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: true, defval: null })
  return rows
    .filter((r) => typeof r[0] === 'string' && /^13\.\d+$/.test(r[0]))
    .map((r) => ({
      group: String(r[1] ?? ''),
      oneTime: /one-time/i.test(String(r[3] ?? '')),
      amount: typeof r[5] === 'number' ? r[5] : 0,
    }))
}

/** A row of the CASH FLOW tab's Annual Cash Flow Summary by label; yearIndex 1 = Year 1. */
function readAnnualCashFlowRow(xlsxPath: string, label: string, yearIndex: number): number | null {
  const wb = XLSX.readFile(xlsxPath)
  const sheet = wb.Sheets['CASH FLOW']
  if (!sheet) return null
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: true, defval: null })
  const start = rows.findIndex((r) => typeof r[0] === 'string' && /annual cash flow summary/i.test(r[0]))
  if (start < 0) return null
  const row = rows.slice(start + 1).find((r) => typeof r[0] === 'string' && r[0].trim() === label)
  const v = row?.[yearIndex + 1]
  return typeof v === 'number' ? v : null
}

test.describe('Suite 3 — Commission Excel CASH FLOW distribution (WA charter)', () => {
  test('Spokane Arts: monthly revenue curve matches per-revenue-type distribution', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)
    const xlsxPath = path.join(ARTIFACT_DIR, 'spokaneArts_cashflow.xlsx')
    await downloadCommissionExcel(page, '', xlsxPath)

    const cf = readCashFlowTab(xlsxPath)

    // 1) 12 months present in OSPI order.
    expect(cf.months.length).toBe(12)
    expect(cf.months.map((m) => m.trim())).toEqual(WA_MONTHS)

    // 2) Revenue row sums to Y1 total revenue (from P&L "Total Revenue" row).
    const revenueRow = cf.rows.find((r) => /^revenue$/i.test(r.label.trim()))
    expect(revenueRow, 'CASH FLOW should have a "Revenue" row').toBeTruthy()
    const monthlySum = revenueRow!.values.reduce((a, b) => a + b, 0)
    const y1TotalRev = readPLRowYear(xlsxPath, 'Total Revenue', 1)
    expect(y1TotalRev, 'P&L should expose Y1 Total Revenue').not.toBeNull()
    // computeMonthlyCashFlow rounds each month's inflow to whole dollars (≤ $0.50/month), so the
    // months can drift a few dollars from the annual total. $20 leaves generous slack.
    expect(Math.abs(monthlySum - (y1TotalRev as number))).toBeLessThanOrEqual(20)

    // 3) Per-revenue-type distribution: read each Y1 revenue input, compute expected monthly
    //    curve, and compare against the actual Revenue row month-by-month.
    const regEd = readRevenueY1ByLabel(xlsxPath, 'Regular Ed Per Pupil') ?? 0
    const sped = readRevenueY1ByLabel(xlsxPath, 'SPED Apportionment') ?? 0
    const stateSped = readRevenueY1ByLabel(xlsxPath, 'State Special Education') ?? 0
    const facRev = readRevenueY1ByLabel(xlsxPath, 'Facilities Per Pupil') ?? 0
    const sse = readRevenueY1ByLabel(xlsxPath, 'Small School Enhancement') ?? 0
    const levy = readRevenueY1ByLabel(xlsxPath, 'Levy Equity') ?? 0
    const titleI = readRevenueY1ByLabel(xlsxPath, 'Title I') ?? 0
    const idea = readRevenueY1ByLabel(xlsxPath, 'IDEA (Federal Special Ed)') ?? 0
    const lap = readRevenueY1ByLabel(xlsxPath, 'LAP (Learning Assistance)') ?? 0
    const lapHP = readRevenueY1ByLabel(xlsxPath, 'LAP High Poverty') ?? 0
    const tbip = readRevenueY1ByLabel(xlsxPath, 'TBIP (Bilingual)') ?? 0
    const hicap = readRevenueY1ByLabel(xlsxPath, 'Highly Capable') ?? 0
    const foodRev = readRevenueY1ByLabel(xlsxPath, 'Food Service (NSLP)') ?? 0
    const transRev = readRevenueY1ByLabel(xlsxPath, 'Transportation (State)') ?? 0
    const interest = readRevenueY1ByLabel(xlsxPath, 'Interest & Other Income') ?? 0

    // Custom revenue lines follow their group's timing; any other group is spread flat like the
    // state categoricals. One-time lines land in September (part of the Sep residual below).
    const custom = readCustomRevenueY1(xlsxPath)
    const TIMED_GROUPS = ['State & Local', 'Federal', 'Program Revenue']
    const recurringCustom = (pred: (group: string) => boolean) =>
      custom.filter((c) => !c.oneTime && pred(c.group)).reduce((s, c) => s + c.amount, 0)

    const stateApport = regEd + sped + stateSped + facRev + sse + levy + recurringCustom((g) => g === 'State & Local')
    const federal = titleI + idea + recurringCustom((g) => g === 'Federal')
    const stateCat = lap + lapHP + tbip + hicap + recurringCustom((g) => !TIMED_GROUPS.includes(g))
    const foodTransport = foodRev + transRev + recurringCustom((g) => g === 'Program Revenue')
    // Startup grants unknown here; Y1 startup grant amount isn't on REVENUE tab.
    // Allow leftover = actual(Sep) - predicted(Sep without grants or one-time custom lines) as
    // the implicit lump sum, then validate it's non-negative and accounts for the Sep spike.

    const expected = WA_MONTHS.map((_m, idx) => {
      let amt = stateApport * OSPI_PCTS[idx] / 100
      if (idx >= 1 && idx <= 10) amt += federal / 10
      amt += stateCat / 12
      if (idx >= 0 && idx <= 9) amt += foodTransport / 10
      amt += interest / 12
      return Math.round(amt)
    })

    // Sep anomaly: actual Sep may include the startup grant / one-time custom lump sum.
    const actual = revenueRow!.values
    const sepDelta = actual[0] - expected[0]
    expect(sepDelta, 'Sep residual (startup grants) must be non-negative').toBeGreaterThanOrEqual(-2)

    // Non-Sep months must match expected within $5 (rounding slack across 5 buckets).
    for (let i = 1; i < 12; i++) {
      expect(Math.abs(actual[i] - expected[i]), `Month ${WA_MONTHS[i]} differs: actual=${actual[i]} expected=${expected[i]}`).toBeLessThanOrEqual(5)
    }

    // Verify curve is NOT the old buggy `y1Total × OSPI_PCT` behavior:
    // compute that alternative and require at least one month to diverge by >$100.
    const naive = WA_MONTHS.map((_m, idx) => Math.round((y1TotalRev as number) * OSPI_PCTS[idx] / 100))
    const anyDiverges = actual.some((v, i) => Math.abs(v - naive[i]) > 100)
    expect(anyDiverges, 'Monthly curve must NOT equal the pre-Fix3 naive formula').toBe(true)

    // 4) Expenses are cash outflows: non-cash facility depreciation is excluded, so the months
    //    sum to P&L Total Expenses less Facility Depreciation (absent for lease schools).
    const expensesRow = cf.rows.find((r) => /^expenses$/i.test(r.label.trim()))
    expect(expensesRow, 'CASH FLOW should have an "Expenses" row').toBeTruthy()
    const y1TotalExp = readPLRowYear(xlsxPath, 'Total Expenses', 1)
    expect(y1TotalExp, 'P&L should expose Y1 Total Expenses').not.toBeNull()
    const y1Depreciation = readPLRowYear(xlsxPath, 'Facility Depreciation', 1) ?? 0
    const monthlyExpSum = expensesRow!.values.reduce((a, b) => a + b, 0)
    expect(Math.abs(monthlyExpSum - ((y1TotalExp as number) - y1Depreciation))).toBeLessThanOrEqual(0.01)

    //    August Ending Cash reconciles with the annual summary's Year 1 Ending Cash (the engine's
    //    year-end cash, which Days of Cash is computed from) within the inflow rounding
    //    (≤ $0.50 × 12 months) plus the whole-dollar rounding of the balance cell.
    const endingRow = cf.rows.find((r) => /^ending cash$/i.test(r.label.trim()))
    expect(endingRow, 'CASH FLOW should have an "Ending Cash" row').toBeTruthy()
    const annualY1Ending = readAnnualCashFlowRow(xlsxPath, 'Ending Cash', 1)
    expect(annualY1Ending, 'Annual Cash Flow Summary should expose Y1 Ending Cash').not.toBeNull()
    expect(Math.abs(endingRow!.values[11] - (annualY1Ending as number))).toBeLessThanOrEqual(7)

    // Log summary for verification report.
    console.log('[suite3:spokaneArts] monthly revenue:', JSON.stringify(actual))
    console.log('[suite3:spokaneArts] predicted     :', JSON.stringify(expected))
    console.log(`[suite3:spokaneArts] Sep residual (implicit startup grants) = $${sepDelta}`)
  })

  test('Cash Flow curve is NOT the pre-Fix3 naive OSPI-on-total formula', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)
    const xlsxPath = path.join(ARTIFACT_DIR, 'spokaneArts_cashflow.xlsx')
    if (!fs.existsSync(xlsxPath)) {
      await downloadCommissionExcel(page, '', xlsxPath)
    }
    const cf = readCashFlowTab(xlsxPath)
    const revenueRow = cf.rows.find((r) => /^revenue$/i.test(r.label.trim()))!
    const y1TotalRev = readPLRowYear(xlsxPath, 'Total Revenue', 1)!

    // Pre-Fix3: every month = y1TotalRev × OSPI_PCT. Under the per-type distribution, at
    // least SEVERAL months must diverge significantly (>$1000) from that naive curve —
    // because federal grants shift out of Sep/Nov/May, food/transport shifts out of Jul/Aug,
    // and startup grants stack into Sep.
    const naive = WA_MONTHS.map((_m, idx) => Math.round(y1TotalRev * OSPI_PCTS[idx] / 100))
    const divergentMonths = revenueRow.values.filter((v, i) => Math.abs(v - naive[i]) > 1000).length
    expect(divergentMonths, 'Several months should diverge from naive OSPI-on-total curve').toBeGreaterThanOrEqual(3)

    // Specifically: Aug (idx 11) under the new formula has NO federal (Oct-Jul only), NO
    // food/transport (Sep-Jun only), NO startup (Sep only). So Aug revenue = (stateApport +
    // levy) × 10% + stateCat/12 + interest/12. That must be STRICTLY LESS than the naive
    // value (which would also add 10% × federal + 10% × food/transport + 10% × startup).
    const titleI = readRevenueY1ByLabel(xlsxPath, 'Title I') ?? 0
    const idea = readRevenueY1ByLabel(xlsxPath, 'IDEA (Federal Special Ed)') ?? 0
    const foodRev = readRevenueY1ByLabel(xlsxPath, 'Food Service (NSLP)') ?? 0
    const transRev = readRevenueY1ByLabel(xlsxPath, 'Transportation (State)') ?? 0
    const shiftedOutOfAug = titleI + idea + foodRev + transRev
    if (shiftedOutOfAug > 0) {
      expect(revenueRow.values[11], 'Aug actual should be less than naive (federal+food shifted away from Aug)')
        .toBeLessThan(naive[11])
    }
  })
})
