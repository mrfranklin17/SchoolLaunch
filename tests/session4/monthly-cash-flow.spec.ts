import { test, expect } from '@playwright/test'
import {
  computeMultiYearDetailed,
  computeGenericProjections,
  computeFPFScorecard,
  computeMonthlyCashFlow,
  computeEnrollmentSensitivity,
  beginningCashOf,
  breakEvenEnrollment,
  facilityCostOf,
  facilityPctOfRevenue,
  personnelPctOfRevenue,
  totalMarginPct,
  runProjections,
  MONTHS,
  type MultiYearDetailedRow,
} from '../../src/lib/budgetEngine'
import { getStateConfig } from '../../src/lib/stateConfig'
import { DEFAULT_ASSUMPTIONS, type SchoolProfile, type StaffingPosition, type BudgetProjection } from '../../src/lib/types'

/**
 * Phase 2: one monthly cash-flow model (computeMonthlyCashFlow) behind the Cash Flow tab,
 * narrative PDF, Commission Excel and admin portfolio view, plus the row-derived metrics
 * every surface shares.
 *
 * Pins: (a) without custom revenue, each month's inflow equals the Commission Excel's
 * per-revenue-type distribution exactly; (b) the August balance reconciles to FPF year-end
 * cash within per-month rounding, for a lease school and a financed one; (c) outflows sum
 * exactly to totalExpenses − depreciation; (d) one-time custom revenue lands in September
 * and recurring Federal custom revenue lands Oct–Jul; (e) generic pathways follow their
 * stateConfig payment_schedule.
 *
 * Run: npx playwright test tests/session4/monthly-cash-flow.spec.ts
 */

const CEDAR_GROVE_FF = { basis: 5175000, useful_life: 30, principal: 5175000, interest_rate: 5, term_years: 30, start_year: 1 }

function profile(extra: Record<string, unknown> = {}): SchoolProfile {
  return {
    school_id: '00000000-0000-0000-0000-00000000cf01',
    region: 'Seattle', planned_open_year: 2027, grade_config: 'K-5',
    target_enrollment_y1: 120, target_enrollment_y2: 150, target_enrollment_y3: 180,
    target_enrollment_y4: 210, target_enrollment_y5: 240,
    max_class_size: 24, pct_frl: 55, pct_iep: 12, pct_ell: 10, pct_hicap: 5,
    onboarding_complete: true, retention_rate: 92,
    financial_assumptions: { food_service_offered: true, transportation_offered: true },
    startup_funding: [{ source: 'CSP Grant', amount: 250000, type: 'grant', status: 'pledged', selectedYears: [1], yearAllocations: { 1: 250000 } }],
    ...extra,
  } as unknown as SchoolProfile
}
const POSITIONS: StaffingPosition[] = [
  { school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
  { school_id: 'x', year: 1, title: 'Teacher', category: 'certificated', fte: 6, annual_salary: 68000, position_type: 'teacher_elem', classification: 'Certificated', driver: 'per_pupil', students_per_position: 22 },
  { school_id: 'x', year: 1, title: 'Paraeducator', category: 'classified', fte: 2, annual_salary: 42000, position_type: 'paraeducator', classification: 'Classified', driver: 'per_pupil', students_per_position: 48 },
]
const PROJECTIONS: BudgetProjection[] = [
  ['Facilities', 180000], ['Supplies & Materials', 24000], ['Technology', 18000], ['Insurance', 18000], ['Curriculum & Materials', 40000],
].map(([sub, amount]) => ({ school_id: 'x', year: 1, category: 'Operations', subcategory: sub as string, amount: amount as number, is_revenue: false }))
const PRE_OPEN = 180000

function wa(extra: Record<string, unknown> = {}): MultiYearDetailedRow[] {
  const p = profile(extra)
  return computeMultiYearDetailed(p, POSITIONS, PROJECTIONS, DEFAULT_ASSUMPTIONS, PRE_OPEN, [], POSITIONS, p.startup_funding)
}
function fpfCash(rows: MultiYearDetailedRow[]): number[] {
  const out: number[] = []
  let cash = PRE_OPEN
  for (const r of rows) { cash += r.net + (r.operations.depreciation ?? 0); out.push(cash) }
  return out
}

// The Commission Excel's WA distribution before Phase 2 (commission/route.ts
// distributeRevenueToMonths), kept here as the reference the shared model must reproduce.
function excelReference(rev: MultiYearDetailedRow['revenue']): number[] {
  const OSPI_PCTS = [9, 8, 5, 9, 8.5, 9, 9, 9, 5, 6, 12.5, 10]
  const stateApport = rev.regularEd + rev.sped + rev.stateSped + rev.facilitiesRev + rev.smallSchoolEnhancement + rev.levyEquity
  const federal = rev.titleI + rev.idea
  const stateCategorical = rev.lap + rev.lapHighPoverty + rev.tbip + rev.hicap
  const foodTransport = rev.foodServiceRev + rev.transportationRev
  return OSPI_PCTS.map((pct, idx) => {
    let amount = 0
    amount += stateApport * pct / 100
    if (idx >= 1 && idx <= 10) amount += federal / 10
    amount += stateCategorical / 12
    if (idx >= 0 && idx <= 9) amount += foodTransport / 10
    amount += rev.interestIncome / 12
    if (idx === 0) amount += rev.grantRevenue
    return Math.round(amount)
  })
}

test.describe('computeMonthlyCashFlow — WA charter', () => {
  test('without custom revenue, monthly inflow matches the Commission Excel distribution exactly', () => {
    const rows = wa()
    expect(rows[0].revenue.titleI + rows[0].revenue.foodServiceRev).toBeGreaterThan(0)
    for (const row of rows) {
      const cf = computeMonthlyCashFlow(row, beginningCashOf(row))
      expect(cf.months.map((m) => m.totalInflow)).toEqual(excelReference(row.revenue))
      expect(cf.months.map((m) => m.month)).toEqual(MONTHS)
      expect(cf.usesOspiSchedule).toBe(true)
      expect(cf.lowScheduleMonths).toEqual(['Nov', 'May'])
    }
  })

  test('August balance reconciles to FPF year-end cash (lease school)', () => {
    const rows = wa()
    const cash = fpfCash(rows)
    rows.forEach((row, i) => {
      expect(row.endingCash).toBe(cash[i])
      const cf = computeMonthlyCashFlow(row, beginningCashOf(row))
      expect(Math.abs(cf.endingCash - cash[i])).toBeLessThanOrEqual(6)
      expect(cf.months[11].cumulativeBalance).toBe(cf.endingCash)
    })
    expect(beginningCashOf(rows[0])).toBe(PRE_OPEN)
  })

  test('financed facility: depreciation is excluded from outflows; balance still reconciles', () => {
    const rows = wa({ facility_financing: CEDAR_GROVE_FF })
    const cash = fpfCash(rows)
    expect(rows[0].operations.depreciation).toBe(172500)
    expect(rows[0].endingCash).toBe(rows[0].cumulativeNet + 172500)
    expect(rows[1].endingCash).toBe(rows[1].cumulativeNet + 2 * 172500)
    rows.forEach((row, i) => {
      expect(row.endingCash).toBe(cash[i])
      const cf = computeMonthlyCashFlow(row, beginningCashOf(row))
      expect(Math.abs(cf.endingCash - cash[i])).toBeLessThanOrEqual(6)
      expect(cf.totals.depreciationExcluded).toBe(172500)
    })
  })

  test('outflows sum exactly to cash expenses; payroll sums exactly to personnel', () => {
    for (const rows of [wa(), wa({ facility_financing: CEDAR_GROVE_FF })]) {
      const row = rows[0]
      const cf = computeMonthlyCashFlow(row, PRE_OPEN)
      const payroll = cf.months.reduce((s, m) => s + m.payroll, 0)
      const other = cf.months.reduce((s, m) => s + m.otherExpenses, 0)
      expect(payroll).toBe(row.personnel.total)
      expect(payroll + other).toBe(row.totalExpenses - (row.operations.depreciation ?? 0))
      for (const m of cf.months) {
        expect(m.netCashFlow).toBe(m.totalInflow - m.payroll - m.otherExpenses)
        expect(m.cumulativeBalance).toBe(m.beginningBalance + m.netCashFlow)
      }
      expect(Math.abs(cf.totals.inflow - row.revenue.total)).toBeLessThanOrEqual(6)
    }
  })

  test('one-time custom revenue lands in September; recurring Federal lands Oct–Jul', () => {
    const base = wa()[0]
    const withCustom = wa({
      custom_revenue_lines: [
        { id: 'f', name: 'Title II (Federal)', group: 'Federal', driver: 'flat', amountY1: 12000, recurring: true },
        { id: 'g', name: 'One-time gift', group: 'Other', driver: 'flat', amountY1: 60000, recurring: false },
      ],
    })[0]
    expect(withCustom.revenue.customRevenue?.map((c) => c.recurring)).toEqual([true, false])
    // Interest income is unchanged in Year 1 (it reads the carry-forward), so the deltas are
    // exactly the custom lines.
    expect(withCustom.revenue.interestIncome).toBe(base.revenue.interestIncome)
    const a = computeMonthlyCashFlow(base, PRE_OPEN).months
    const b = computeMonthlyCashFlow(withCustom, PRE_OPEN).months
    const delta = b.map((m, i) => m.totalInflow - a[i].totalInflow)
    expect(delta[0]).toBe(60000)
    for (let i = 1; i <= 10; i++) expect(Math.abs(delta[i] - 1200)).toBeLessThanOrEqual(1)
    expect(Math.abs(delta[11])).toBeLessThanOrEqual(1)
  })

  test('levy equity follows the OSPI schedule', () => {
    const p = profile()
    const row = computeMultiYearDetailed(p, POSITIONS, PROJECTIONS, { ...DEFAULT_ASSUMPTIONS, levy_equity_per_student: 1200 }, PRE_OPEN, [], POSITIONS, p.startup_funding)[0]
    expect(row.revenue.levyEquity).toBeGreaterThan(0)
    const cf = computeMonthlyCashFlow(row, PRE_OPEN)
    const ospi = row.revenue.regularEd + row.revenue.sped + row.revenue.stateSped + row.revenue.facilitiesRev + row.revenue.smallSchoolEnhancement + row.revenue.levyEquity
    expect(cf.months[2].apportionmentAmt).toBe(Math.round(ospi * 5 / 100))
  })
})

test.describe('computeMonthlyCashFlow — generic pathways', () => {
  for (const pathway of ['generic_private', 'generic_charter'] as const) {
    test(`${pathway} follows the stateConfig payment schedule`, () => {
      const cfg = getStateConfig(pathway)
      const p = profile({
        financial_assumptions: {}, tuition_rate: 14000, financial_aid_pct: 0.1,
        custom_revenue_lines: [
          { key: 'registration_fees', label: 'Registration', amount: 36000 },
          { key: 'fundraising', label: 'Fundraising', amount: 40000 },
          { key: 'per_pupil_funding', label: 'Per pupil', amount: 1200000 },
        ],
      })
      const row = computeGenericProjections(p, POSITIONS, PROJECTIONS, cfg, PRE_OPEN, [], POSITIONS, p.startup_funding)[0]
      const cf = computeMonthlyCashFlow(row, beginningCashOf(row), { pathway })
      expect(cf.usesOspiSchedule).toBe(false)
      const scheduled = row.revenue.total - row.revenue.grantRevenue - row.revenue.interestIncome
      cf.months.forEach((m, i) => {
        expect(m.apportionmentPct).toBeCloseTo(cfg.payment_schedule[i] / 100, 10)
        expect(m.apportionmentAmt).toBe(Math.round(scheduled * cfg.payment_schedule[i] / 100))
      })
      expect(Math.abs(cf.totals.inflow - row.revenue.total)).toBeLessThanOrEqual(6)
      expect(Math.abs(cf.endingCash - row.endingCash)).toBeLessThanOrEqual(6)
      expect(row.endingCash).toBe(row.cumulativeNet)
      if (pathway === 'generic_private') {
        // Tuition is collected Sep–Jun; July and August carry only interest.
        expect(cf.lowScheduleMonths).toEqual(['Jul', 'Aug'])
        expect(cf.months[10].apportionmentAmt).toBe(0)
      } else {
        expect(cf.lowScheduleMonths).toEqual([])
      }
    })
  }
})

test.describe('row-derived metrics', () => {
  test('personnel %, facility %, break-even and total margin', () => {
    const lease = wa()[0]
    expect(personnelPctOfRevenue(lease)).toBeCloseTo(lease.personnel.total / lease.revenue.operatingRevenue * 100, 10)
    expect(facilityCostOf(lease)).toBe(lease.operations.facilities)
    expect(facilityPctOfRevenue(lease)).toBeCloseTo(lease.operations.facilities / lease.revenue.operatingRevenue * 100, 10)
    expect(breakEvenEnrollment(lease)).toBe(Math.ceil(lease.totalExpenses / (lease.revenue.operatingRevenue / lease.enrollment)))

    const financed = wa({ facility_financing: CEDAR_GROVE_FF })[0]
    expect(facilityCostOf(financed)).toBe(financed.operations.facilities + 172500 + 257016)

    const rows = wa()
    const fpfMargin = computeFPFScorecard(rows, PRE_OPEN, false).measures.find((m) => m.name === 'Total Margin')!.values
    expect(rows.map((r) => totalMarginPct(r))).toEqual(fpfMargin)
  })

  test('runProjections branches on pathway', () => {
    const p = profile()
    const inputs = { profile: p, positions: POSITIONS, projections: PROJECTIONS, assumptions: DEFAULT_ASSUMPTIONS, preOpenCash: PRE_OPEN, gradeExpansionPlan: [], allPositions: POSITIONS, startupFunding: p.startup_funding }
    expect(runProjections({ ...inputs, pathway: 'wa_charter' })).toEqual(wa())
    expect(runProjections({ ...inputs, pathway: 'generic_charter' })).toEqual(
      computeGenericProjections(p, POSITIONS, PROJECTIONS, getStateConfig('generic_charter'), PRE_OPEN, [], POSITIONS, p.startup_funding),
    )
  })

  test('90% enrollment sensitivity holds expenses at base and lowers revenue and days of cash', () => {
    const p = profile()
    const s = computeEnrollmentSensitivity({ pathway: 'wa_charter', profile: p, positions: POSITIONS, projections: PROJECTIONS, assumptions: DEFAULT_ASSUMPTIONS, preOpenCash: PRE_OPEN, gradeExpansionPlan: [], allPositions: POSITIONS, startupFunding: p.startup_funding })
    const base = wa()[0]
    expect(s.baseEnrollment).toBe(120)
    expect(s.enrollment).toBe(108)
    expect(s.totalExpenses).toBe(base.totalExpenses)
    expect(s.baseTotalRevenue).toBe(base.revenue.total)
    expect(s.totalRevenue).toBeLessThan(base.revenue.total)
    expect(s.netPosition).toBe(s.totalRevenue - base.totalExpenses)
    expect(s.baseDaysOfCash).toBe(base.reserveDays)
    expect(s.daysOfCash).toBeLessThan(s.baseDaysOfCash)
  })
})
