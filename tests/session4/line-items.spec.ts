import { test, expect } from '@playwright/test'
import { runProjections, type MultiYearDetailedRow } from '../../src/lib/budgetEngine'
import {
  operationsLines, revenueBreakdown, revenueLines, lineSeries, visibleLines, sumLines,
  DEPRECIATION_LABEL, FACILITY_INTEREST_LABEL, CONTINGENCY_LABEL, OPERATIONS_CATEGORIES,
} from '../../src/lib/lineItems'
import type { SchoolProfile, StaffingPosition, BudgetProjection, StartupFundingSource } from '../../src/lib/types'
import { DEFAULT_ASSUMPTIONS } from '../../src/lib/types'

/**
 * P2-FU-04 - line items that add up to the engine totals.
 *
 * Multi-Year's Revenue and Operations sections, the Operations tab's Total Operations and the
 * Overview Base Case table list lines from src/lib/lineItems.ts. These tests pin that, for
 * every year of WA and generic engine rows (with and without facility financing, custom
 * expense lines and custom revenue lines, startup grants and interest), the lines sum to the
 * engine's own totals.
 *
 * Run: npx playwright test tests/session4/line-items.spec.ts
 */

const FF = { basis: 5175000, useful_life: 30, principal: 5175000, interest_rate: 5, term_years: 30, start_year: 2 }
const CUSTOM_EXPENSE = [
  { id: 'cx-flat', name: 'Facility O&M', group: 'Facility O&M', driver: 'flat', amountY1: 24000 },
  { id: 'cx-pp', name: 'Testing', group: 'School Operations', driver: 'per_pupil', amountY1: 9000 },
  { id: 'cx-pct', name: 'Management Company Fee', group: 'Contracted Services', driver: 'pct_revenue', rate: 4 },
  // Legacy shape with no id: normalizes to its name, so ids can repeat.
  { name: 'Legacy line', amount: 5000 },
  { name: 'Legacy line', amount: 7000 },
]
const CUSTOM_REVENUE = [
  { id: 'cr-rec', name: 'Before/After Care', group: 'Other', driver: 'per_pupil', amountY1: 30000 },
  { id: 'cr-once', name: 'Capital Campaign Gift', group: 'Other', driver: 'flat', amountY1: 50000, recurring: false },
]
const FUNDING: StartupFundingSource[] = [
  { source: 'CSP Grant', amount: 300000, type: 'grant', status: 'received', selectedYears: [0, 1, 2], yearAllocations: { 0: 100000, 1: 120000, 2: 80000 } },
]

function profile(pathway: string, extra: Record<string, unknown> = {}): SchoolProfile {
  return {
    school_id: '00000000-0000-0000-0000-0000000000f4',
    region: 'Seattle', planned_open_year: 2027, grade_config: 'K-5', pathway,
    target_enrollment_y1: 150, target_enrollment_y2: 180, target_enrollment_y3: 210,
    target_enrollment_y4: 240, target_enrollment_y5: 260,
    max_class_size: 24, pct_frl: 45, pct_iep: 12, pct_ell: 10, pct_hicap: 5,
    onboarding_complete: true, financial_assumptions: {}, retention_rate: 1.0,
    ...extra,
  } as unknown as SchoolProfile
}
const POSITIONS: StaffingPosition[] = [
  { school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
  { school_id: 'x', year: 1, title: 'Lead Teacher', category: 'certificated', fte: 6, annual_salary: 62000, position_type: 'teacher', classification: 'Certificated', driver: 'enrollment', students_per_position: 25 },
]
const op = (subcategory: string, amount: number, year = 1): BudgetProjection =>
  ({ school_id: 'x', year, category: 'Operations', subcategory, amount, is_revenue: false })
const PROJECTIONS: BudgetProjection[] = [
  op('Facilities', 180000), op('Supplies & Materials', 30000), op('Technology', 27000),
  op('Insurance', 18000), op('Curriculum & Materials', 75000), op('Professional Development', 7000),
  op('Marketing & Outreach', 10000), op('Fundraising', 15000), op('Contracted Services', 22000),
  // A later-year row for the same subcategory: the WA engine reads Year 1 only.
  op('Supplies & Materials', 99999, 2),
]

function run(pathway: string, extra: Record<string, unknown> = {}, opts: { funding?: StartupFundingSource[]; preOpenCash?: number } = {}): MultiYearDetailedRow[] {
  return runProjections({
    pathway,
    profile: profile(pathway, extra),
    positions: POSITIONS,
    projections: PROJECTIONS,
    assumptions: DEFAULT_ASSUMPTIONS,
    preOpenCash: opts.preOpenCash ?? 400000,
    allPositions: POSITIONS,
    startupFunding: opts.funding ?? null,
  })
}

/** Every reconciliation the three surfaces rely on, for every year. */
function expectReconciles(rows: MultiYearDetailedRow[], pathway: string, revenueModel?: string) {
  expect(rows).toHaveLength(5)
  for (const row of rows) {
    const ops = operationsLines(row)
    expect(sumLines(ops)).toBe(row.operations.total)
    expect(sumLines(visibleLines(ops))).toBe(row.operations.total)
    expect(new Set(ops.map((l) => l.key)).size).toBe(ops.length)

    const b = revenueBreakdown(row, { pathway, revenueModel })
    expect(b.operatingTotal).toBe(row.revenue.operatingRevenue)
    expect(b.total).toBe(row.revenue.total)
    expect(sumLines(b.operating)).toBe(row.revenue.operatingRevenue)
    expect(sumLines(b.nonOperating)).toBe(row.revenue.total - row.revenue.operatingRevenue)
    const rev = revenueLines(row, { pathway, revenueModel })
    expect(sumLines(rev)).toBe(row.revenue.total)
    expect(sumLines(visibleLines(rev))).toBe(row.revenue.total)
    expect(new Set(rev.map((l) => l.key)).size).toBe(rev.length)

    // Overview's expense block: personnel + operations = total expenses.
    expect(row.personnel.total + row.operations.total).toBe(row.totalExpenses)
  }

  // Multi-Year tables: each year's column sums to that year's engine total.
  const opsTable = lineSeries(rows.map(operationsLines))
  const revOperating = lineSeries(rows.map((r) => revenueBreakdown(r, { pathway, revenueModel }).operating))
  const revNonOperating = lineSeries(rows.map((r) => revenueBreakdown(r, { pathway, revenueModel }).nonOperating))
  rows.forEach((row, i) => {
    expect(opsTable.reduce((s, l) => s + l.values[i], 0)).toBe(row.operations.total)
    expect(revOperating.reduce((s, l) => s + l.values[i], 0)).toBe(row.revenue.operatingRevenue)
    expect(revOperating.reduce((s, l) => s + l.values[i], 0) + revNonOperating.reduce((s, l) => s + l.values[i], 0)).toBe(row.revenue.total)
  })
  return { opsTable, revOperating, revNonOperating }
}

test.describe('P2-FU-04 - WA Charter lines add up to the engine totals', () => {
  test('lease school, no custom lines', () => {
    const rows = run('wa_charter', {}, { funding: FUNDING })
    expect(rows[0].operations.depreciation).toBeUndefined()
    expect(rows[0].revenue.interestIncome).toBeGreaterThan(0)
    expect(rows[0].revenue.grantRevenue).toBe(120000)
    const { opsTable, revNonOperating } = expectReconciles(rows, 'wa_charter')
    // 12 built-in categories + contingency; no financing rows for a lease school.
    expect(opsTable.map((l) => l.key)).toEqual([...OPERATIONS_CATEGORIES.map((c) => c.key), 'contingency'])
    expect(opsTable.find((l) => l.key === 'contingency')!.label).toBe(CONTINGENCY_LABEL)
    expect(opsTable.find((l) => l.key === 'contingency')!.values.every((v) => v > 0)).toBe(true)
    expect(revNonOperating.map((l) => l.key)).toEqual(['interest', 'grants'])
  })

  test('the Year 2 projection row never reaches Year 1 supplies', () => {
    const rows = run('wa_charter')
    expect(operationsLines(rows[0]).find((l) => l.key === 'supplies')!.amount).toBe(30000)
  })

  test('facility financing, custom expense and custom revenue lines', () => {
    const rows = run('wa_charter', {
      facility_financing: FF,
      custom_expense_lines: CUSTOM_EXPENSE,
      custom_revenue_lines: CUSTOM_REVENUE,
    }, { funding: FUNDING })
    const { opsTable, revOperating, revNonOperating } = expectReconciles(rows, 'wa_charter')

    // Depreciation is labeled non-cash; financing starts in Year 2.
    const dep = opsTable.find((l) => l.key === 'depreciation')!
    expect(dep.label).toBe(DEPRECIATION_LABEL)
    expect(dep.label).toMatch(/non-cash/i)
    expect(dep.nonCash).toBe(true)
    expect(dep.values[0]).toBe(0)
    expect(dep.values[1]).toBe(172500)
    const interest = opsTable.find((l) => l.key === 'facilityInterest')!
    expect(interest.label).toBe(FACILITY_INTEREST_LABEL)
    expect(interest.nonCash).toBeUndefined()
    expect(interest.values[1]).toBeGreaterThan(0)

    // Every custom expense line has its own row, including the repeated legacy id.
    const customRows = opsTable.filter((l) => l.key.startsWith('custom-expense:'))
    expect(customRows.map((l) => l.label)).toEqual(['Facility O&M', 'Testing', 'Management Company Fee', 'Legacy line', 'Legacy line'])
    expect(customRows.find((l) => l.label === 'Management Company Fee')!.values[0]).toBeGreaterThan(0)

    // Recurring custom revenue is operating; one-time is non-operating.
    expect(revOperating.some((l) => l.label === 'Before/After Care')).toBe(true)
    const oneTime = revNonOperating.find((l) => l.label === 'Capital Campaign Gift (one-time)')!
    expect(oneTime.values[0]).toBe(50000)
  })

  test('optional WA lines appear only when non-zero in some year', () => {
    const plain = expectReconciles(run('wa_charter'), 'wa_charter')
    expect(plain.revOperating.some((l) => l.key === 'foodServiceRev')).toBe(false)
    expect(plain.revNonOperating.some((l) => l.key === 'grants')).toBe(false)
    const rows = runProjections({
      pathway: 'wa_charter', profile: profile('wa_charter'), positions: POSITIONS, projections: PROJECTIONS,
      assumptions: { ...DEFAULT_ASSUMPTIONS, food_service_offered: true }, preOpenCash: 0, allPositions: POSITIONS,
    })
    const food = expectReconciles(rows, 'wa_charter')
    expect(food.revOperating.some((l) => l.key === 'foodServiceRev')).toBe(true)
  })

  test('negative starting cash (no interest) still reconciles', () => {
    expectReconciles(run('wa_charter', { facility_financing: FF }, { preOpenCash: -250000 }), 'wa_charter')
  })
})

test.describe('P2-FU-04 - generic pathways add up to the engine totals', () => {
  test('per-pupil charter: interest is operating revenue, grants are not', () => {
    const rows = run('generic_charter', {
      custom_revenue_lines: [
        { key: 'per_pupil_funding', label: 'Per-Pupil Funding', amount: 150 * 12000 },
        { key: 'fundraising', label: 'Fundraising', amount: 40000 },
      ],
    }, { funding: FUNDING })
    expect(rows[0].revenue.interestIncome).toBeGreaterThan(0)
    const { opsTable, revOperating, revNonOperating } = expectReconciles(rows, 'generic_charter', 'per_pupil')
    expect(revOperating.map((l) => l.label)).toEqual(['Per-Pupil Revenue', 'Fundraising', 'Interest Income'])
    expect(revOperating.find((l) => l.key === 'otherOperating')!.values[0]).toBe(40000)
    expect(revNonOperating.map((l) => l.key)).toEqual(['grants'])
    expect(opsTable.some((l) => l.key === 'depreciation' || l.key.startsWith('custom-expense:'))).toBe(false)
  })

  test('tuition private school: tuition, fees & fundraising, interest', () => {
    const rows = run('generic_private', {
      tuition_rate: 15000, financial_aid_pct: 0.1,
      custom_revenue_lines: [{ key: 'registration_fees', label: 'Registration Fees', amount: 22000 }],
      // WA-only inputs: the generic engine ignores them, and so do the lines.
      facility_financing: FF,
      custom_expense_lines: CUSTOM_EXPENSE,
    }, { funding: FUNDING })
    const { revOperating } = expectReconciles(rows, 'generic_private', 'tuition')
    expect(revOperating.map((l) => l.label)).toEqual(['Net Tuition Revenue', 'Registration Fees & Fundraising', 'Interest Income'])
    expect(revOperating[0].values[0]).toBe(rows[0].revenue.regularEd)
  })

  test('micro school with no starting cash and no grants', () => {
    const rows = run('generic_micro', {}, { preOpenCash: 0 })
    const { revOperating, revNonOperating } = expectReconciles(rows, 'generic_micro', 'tuition')
    expect(revNonOperating).toEqual([])
    expect(revOperating.length).toBeGreaterThan(0)
  })
})

test.describe('P2-FU-04 - lineSeries', () => {
  test('matches lines by key across years and fills missing years with 0', () => {
    const series = lineSeries([
      [{ key: 'a', label: 'A', amount: 1 }, { key: 'x', label: 'X', amount: 5, optional: true }],
      [{ key: 'a', label: 'A', amount: 2 }, { key: 'b', label: 'B', amount: 3 }],
    ])
    expect(series).toEqual([
      { key: 'a', label: 'A', values: [1, 2] },
      { key: 'x', label: 'X', values: [5, 0] },
      { key: 'b', label: 'B', values: [0, 3] },
    ])
  })

  test('drops optional lines that are $0 every year, keeps required $0 lines', () => {
    const series = lineSeries([
      [{ key: 'a', label: 'A', amount: 0 }, { key: 'x', label: 'X', amount: 0, optional: true }],
      [{ key: 'a', label: 'A', amount: 0 }, { key: 'x', label: 'X', amount: 0, optional: true }],
    ])
    expect(series.map((s) => s.key)).toEqual(['a'])
  })
})
