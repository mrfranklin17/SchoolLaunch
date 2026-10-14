import { test, expect } from '@playwright/test'
import {
  computeMultiYearDetailed,
  computeMonthlyCashFlow,
  beginningCashOf,
  authorizerFeeBase,
  isCspSource,
  isStateAccountLine,
  oneTimeGrantAllocationsForYear,
  stateApportionmentBase,
  totalMarginPct,
  type MultiYearDetailedRow,
} from '../../src/lib/budgetEngine'
import { calcCommissionRevenue } from '../../src/lib/calculations'
import { revenueBreakdown } from '../../src/lib/lineItems'
import { DEFAULT_ASSUMPTIONS, type SchoolProfile, type StaffingPosition, type BudgetProjection, type StartupFundingSource } from '../../src/lib/types'

/**
 * R-REV-04: with csp_operating_revenue on (the default), CSP grant allocations for Years 1-5 are
 * recurring federal operating revenue instead of one-time grants; totals, net and cash are
 * unchanged either way. R-REV-06: the authorizer fee is 3% of state operating funding.
 *
 * Run: npx playwright test tests/session4/csp-and-fee-base.spec.ts
 */

const FUNDING: StartupFundingSource[] = [
  { source: 'Federal CSP Grant', amount: 900000, type: 'grant', status: 'pledged', selectedYears: [0, 1, 2, 3], yearAllocations: { 0: 150000, 1: 300000, 2: 250000, 3: 200000 } },
  { source: 'Walton Family Foundation', amount: 100000, type: 'grant', status: 'received', selectedYears: [1], yearAllocations: { 1: 100000 } },
]

function profile(extra: Record<string, unknown> = {}): SchoolProfile {
  return {
    school_id: '00000000-0000-0000-0000-00000000c5b1',
    region: 'Seattle', planned_open_year: 2027, grade_config: 'K-5',
    target_enrollment_y1: 120, target_enrollment_y2: 150, target_enrollment_y3: 180,
    target_enrollment_y4: 210, target_enrollment_y5: 240,
    max_class_size: 24, pct_frl: 55, pct_iep: 12, pct_ell: 10, pct_hicap: 5,
    onboarding_complete: true, retention_rate: 92,
    financial_assumptions: { transportation_offered: true },
    startup_funding: FUNDING,
    ...extra,
  } as unknown as SchoolProfile
}
const POSITIONS: StaffingPosition[] = [
  { school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
  { school_id: 'x', year: 1, title: 'Teacher', category: 'certificated', fte: 6, annual_salary: 68000, position_type: 'teacher_elem', classification: 'Certificated', driver: 'per_pupil', students_per_position: 22 },
]
const PROJECTIONS: BudgetProjection[] = [
  ['Facilities', 180000], ['Supplies & Materials', 24000], ['Insurance', 18000],
].map(([sub, amount]) => ({ school_id: 'x', year: 1, category: 'Operations', subcategory: sub as string, amount: amount as number, is_revenue: false }))

function run(cspOperating?: boolean, extra: Record<string, unknown> = {}): MultiYearDetailedRow[] {
  const p = profile(extra)
  const assumptions = cspOperating === undefined ? DEFAULT_ASSUMPTIONS : { ...DEFAULT_ASSUMPTIONS, csp_operating_revenue: cspOperating }
  return computeMultiYearDetailed(p, POSITIONS, PROJECTIONS, assumptions, 150000, [], POSITIONS, p.startup_funding)
}

test.describe('CSP grant as operating revenue (R-REV-04)', () => {
  test('CSP sources are recognized by name', () => {
    expect(isCspSource('Federal CSP Grant')).toBe(true)
    expect(isCspSource('Charter Schools Program (federal)')).toBe(true)
    expect(isCspSource('csp subgrant')).toBe(true)
    expect(isCspSource('Walton Family Foundation')).toBe(false)
    expect(isCspSource('CSPAN donation')).toBe(false)
  })

  test('on by default: Years 1-3 CSP moves from grants to recurring federal operating revenue', () => {
    const on = run()
    const off = run(false)
    const csp = [300000, 250000, 200000, 0, 0]
    on.forEach((r, i) => {
      expect(r.revenue.grantRevenue).toBe(off[i].revenue.grantRevenue - csp[i])
      expect(r.revenue.operatingRevenue).toBe(off[i].revenue.operatingRevenue + csp[i])
      const line = (r.revenue.customRevenue ?? []).find((c) => c.id === 'csp-Federal CSP Grant')
      expect(line?.amount ?? 0).toBe(csp[i])
      if (line) expect(line).toMatchObject({ group: 'Federal', recurring: true, name: 'Federal CSP Grant' })
    })
    // The foundation grant stays a one-time grant.
    expect(on[0].revenue.grantRevenue).toBe(100000)
    expect(run(true)).toEqual(on)
  })

  test('totals, net and cash are the same either way; only the operating denominator moves', () => {
    const on = run(true)
    const off = run(false)
    on.forEach((r, i) => {
      expect(r.revenue.total).toBe(off[i].revenue.total)
      expect(r.net).toBe(off[i].net)
      expect(r.endingCash).toBe(off[i].endingCash)
      expect(r.reserveDays).toBe(off[i].reserveDays)
    })
    expect(Math.abs(totalMarginPct(on[0]))).toBeLessThanOrEqual(Math.abs(totalMarginPct(off[0])))
  })

  test('lines still add up to the totals, and monthly cash still reconciles to year-end', () => {
    const rows = run(true)
    for (const r of rows) {
      const b = revenueBreakdown(r, { pathway: 'wa_charter' })
      expect(b.operating.reduce((s, l) => s + l.amount, 0)).toBe(r.revenue.operatingRevenue)
      expect([...b.operating, ...b.nonOperating].reduce((s, l) => s + l.amount, 0)).toBe(r.revenue.total)
    }
    const y1 = rows[0]
    const cf = computeMonthlyCashFlow(y1, beginningCashOf(y1), { pathway: 'wa_charter' })
    expect(Math.abs(cf.totals.inflow - y1.revenue.total)).toBeLessThanOrEqual(12) // per-month rounding
    // CSP is reimbursement-paced with the other federal lines: nothing extra lands in September.
    const off = computeMonthlyCashFlow(run(false)[0], beginningCashOf(run(false)[0]), { pathway: 'wa_charter' })
    expect(cf.months[0].totalInflow).toBe(off.months[0].totalInflow - 300000)
  })

  test('a CSP source saved with another type still counts; a CSP loan does not', () => {
    const funding: StartupFundingSource[] = [
      { source: 'Federal CSP Grant', amount: 400000, type: 'donation', status: 'pledged', selectedYears: [1], yearAllocations: { 1: 400000 } },
      { source: 'CSP bridge loan', amount: 50000, type: 'debt', status: 'pledged', selectedYears: [1], yearAllocations: { 1: 50000 } },
    ]
    const y1 = run(true, { startup_funding: funding })[0]
    expect(y1.revenue.grantRevenue).toBe(50000)
    expect((y1.revenue.customRevenue ?? []).map((c) => c.id)).toEqual(['csp-Federal CSP Grant'])
  })

  test("the Revenue tab's one-time grant rows leave CSP out only when it's operating", () => {
    expect(oneTimeGrantAllocationsForYear(FUNDING, 1, true).map((a) => a.source)).toEqual(['Walton Family Foundation'])
    expect(oneTimeGrantAllocationsForYear(FUNDING, 1, false).map((a) => a.source)).toEqual(['Federal CSP Grant', 'Walton Family Foundation'])
  })
})

test.describe('authorizer fee base (R-REV-06)', () => {
  const rev = calcCommissionRevenue(120, 55, 12, 10, 5, { ...DEFAULT_ASSUMPTIONS, transportation_offered: true, food_service_offered: true })

  test('state operating funding: apportionment base plus state categoricals and state transportation', () => {
    expect(authorizerFeeBase(rev, 50000)).toBe(
      stateApportionmentBase(rev, 50000) + rev.lap + rev.lapHighPoverty + rev.tbip + rev.hicap + rev.transportationRev,
    )
    // Federal (Title I, IDEA, NSLP food service) and levy equity stay out.
    const withFederal = { ...rev, titleI: rev.titleI + 1e6, idea: rev.idea + 1e6, foodServiceRev: rev.foodServiceRev + 1e6, levyEquity: 1e6 }
    expect(authorizerFeeBase(withFederal, 50000)).toBe(authorizerFeeBase(rev, 50000))
  })

  test('recurring custom lines with a state account code count; federal, local and one-time ones do not', () => {
    expect(isStateAccountLine('State Food Service (4198)')).toBe(true)
    expect(isStateAccountLine('Transportation Operations (4199)')).toBe(true)
    expect(isStateAccountLine('OSPI Special Purpose Unassigned (6100)')).toBe(false)
    expect(isStateAccountLine('Sale of Goods/Supplies/Services (2200)')).toBe(false)
    expect(isStateAccountLine('Title II (Federal)')).toBe(false)
    const custom = [
      { name: 'State Food Service (4198)', amount: 3000, recurring: true },
      { name: 'Title II (Federal)', amount: 5000, recurring: true },
      { name: 'One-time state grant (4500)', amount: 7000, recurring: false },
    ]
    expect(authorizerFeeBase(rev, 0, custom)).toBe(authorizerFeeBase(rev, 0) + 3000)
  })

  test('the engine charges 3% of that base', () => {
    const extra = { custom_revenue_lines: [{ id: 'sfs', name: 'State Food Service (4198)', group: 'Program Revenue', driver: 'flat', amountY1: 12000, recurring: true }] }
    const y1 = run(true, extra)[0]
    const custom = y1.revenue.customRevenue ?? []
    const base = authorizerFeeBase({ ...y1.revenue }, y1.revenue.smallSchoolEnhancement, custom)
    expect(base).toBeGreaterThan(y1.revenue.apportionment)
    expect(y1.operations.authorizerFee).toBe(Math.round(base * 0.03))
  })
})
