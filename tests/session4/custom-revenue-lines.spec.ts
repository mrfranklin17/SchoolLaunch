import { test, expect } from '@playwright/test'
import { computeMultiYearDetailed, computeGenericProjections, computeFPFScorecard } from '../../src/lib/budgetEngine'
import { getStateConfig } from '../../src/lib/stateConfig'
import type { SchoolProfile, StaffingPosition, BudgetProjection } from '../../src/lib/types'
import { DEFAULT_ASSUMPTIONS } from '../../src/lib/types'

/**
 * R-REV-03 - custom revenue lines for the WA Charter pathway.
 *
 * Verifies the four ratio drivers, recurring vs one-time routing into
 * operatingRevenue, perYearOverrides supersession, legacy {key,label,amount}
 * tolerance, the no-custom regression (byte-identical), and Generic-pathway
 * isolation (WA-shaped lines invisible to the Generic engine; legacy lines still
 * consumed by it).
 *
 * Run: npx playwright test tests/session4/custom-revenue-lines.spec.ts
 */

const COLA = 1 + DEFAULT_ASSUMPTIONS.revenue_cola_pct / 100 // 1.03

function waProfile(customRevenueLines?: unknown): SchoolProfile {
  const p: Record<string, unknown> = {
    school_id: '00000000-0000-0000-0000-0000000000aa',
    region: 'Seattle',
    planned_open_year: 2027,
    grade_config: 'K-5',
    target_enrollment_y1: 100,
    target_enrollment_y2: 120,
    target_enrollment_y3: 140,
    target_enrollment_y4: 160,
    target_enrollment_y5: 180,
    max_class_size: 24,
    pct_frl: 40, pct_iep: 12, pct_ell: 10, pct_hicap: 5,
    onboarding_complete: true,
    financial_assumptions: {},
    retention_rate: 1.0,
  }
  if (customRevenueLines !== undefined) p.custom_revenue_lines = customRevenueLines
  return p as unknown as SchoolProfile
}

const POSITIONS: StaffingPosition[] = [
  { school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
]
const PROJECTIONS: BudgetProjection[] = [
  { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 120000, is_revenue: false },
]

function runWa(customRevenueLines?: unknown) {
  return computeMultiYearDetailed(waProfile(customRevenueLines), POSITIONS, PROJECTIONS, DEFAULT_ASSUMPTIONS, 0)
}
function customAmounts(rows: ReturnType<typeof runWa>, id: string): number[] {
  return rows.map((r) => (r.revenue.customRevenue || []).find((c) => c.id === id)?.amount ?? 0)
}

test.describe('R-REV-03 - custom revenue lines (WA Charter)', () => {
  test('per_pupil driver scales by enrollment ratio and revenue COLA', () => {
    const rows = runWa([{ id: 'pp', name: 'Per Pupil Line', group: 'Other', driver: 'per_pupil', amountY1: 10000 }])
    const amts = customAmounts(rows, 'pp')
    expect(amts[0]).toBe(10000)                                   // Y1: ratio 1, cola^0
    expect(amts[1]).toBe(Math.round(10000 * (120 / 100) * COLA))  // Y2: 12360
    expect(amts[2]).toBe(Math.round(10000 * (140 / 100) * COLA * COLA))
  })

  test('flat driver is constant; inflation driver escalates by COLA', () => {
    const rows = runWa([
      { id: 'flat', name: 'Flat', group: 'Other', driver: 'flat', amountY1: 5000 },
      { id: 'infl', name: 'Inflation', group: 'Other', driver: 'inflation', amountY1: 8000 },
    ])
    expect(customAmounts(rows, 'flat')).toEqual([5000, 5000, 5000, 5000, 5000])
    expect(customAmounts(rows, 'infl')[1]).toBe(Math.round(8000 * COLA))
    expect(customAmounts(rows, 'infl')[2]).toBe(Math.round(8000 * COLA * COLA))
  })

  test('per_fte driver scales by FTE ratio (constant FTE here) x COLA', () => {
    const rows = runWa([{ id: 'fte', name: 'Per FTE', group: 'Other', driver: 'per_fte', amountY1: 6000 }])
    // No allPositions passed -> each year reuses Y1 positions -> FTE ratio = 1.
    expect(customAmounts(rows, 'fte')[0]).toBe(6000)
    expect(customAmounts(rows, 'fte')[1]).toBe(Math.round(6000 * COLA))
  })

  test('recurring folds into operatingRevenue; one-time folds into total only', () => {
    const base = runWa([])
    const baseOp = base[0].revenue.operatingRevenue
    const baseTotal = base[0].revenue.total

    const recurring = runWa([{ id: 'r', name: 'Recurring', group: 'Other', driver: 'flat', amountY1: 50000, recurring: true }])
    expect(recurring[0].revenue.operatingRevenue).toBe(baseOp + 50000)
    expect(recurring[0].revenue.total).toBe(baseTotal + 50000)

    const oneTime = runWa([{ id: 'o', name: 'One Time', group: 'Other', driver: 'flat', amountY1: 50000, recurring: false }])
    expect(oneTime[0].revenue.operatingRevenue).toBe(baseOp)            // NOT in operating
    expect(oneTime[0].revenue.total).toBe(baseTotal + 50000)           // but in total
  })

  test('FPF: both recurring and one-time lines move Total Margin (net ÷ total revenue); only recurring moves operatingRevenue', () => {
    const baseRows = runWa([])
    const recRows = runWa([{ id: 'r', name: 'R', group: 'Other', driver: 'flat', amountY1: 200000, recurring: true }])
    const oneRows = runWa([{ id: 'o', name: 'O', group: 'Other', driver: 'flat', amountY1: 200000, recurring: false }])
    const margin = (rows: ReturnType<typeof runWa>) =>
      computeFPFScorecard(rows, 250000, false).measures.find((m) => m.name === 'Total Margin')!.values[0]
    // FPF-01: Total Margin = net ÷ total revenue, so both kinds of line move it.
    expect(margin(recRows)).not.toBe(margin(baseRows))
    expect(margin(oneRows)).not.toBe(margin(baseRows))
    expect(margin(oneRows)).toBe(Math.round((oneRows[0].net / oneRows[0].revenue.total) * 1000) / 10)
    // One-time is non-operating: operatingRevenue unchanged vs base.
    expect(oneRows[0].revenue.operatingRevenue).toBe(baseRows[0].revenue.operatingRevenue)
  })

  test('perYearOverrides supersedes the driver for that year', () => {
    const rows = runWa([{ id: 'ov', name: 'Override', group: 'Other', driver: 'flat', amountY1: 1000, perYearOverrides: { 2: 99999 } }])
    const amts = customAmounts(rows, 'ov')
    expect(amts[0]).toBe(1000)    // Y1: driver
    expect(amts[1]).toBe(99999)   // Y2: override
    expect(amts[2]).toBe(1000)    // Y3: driver
  })

  test('legacy {key,label,amount} shape reads as a flat line without error', () => {
    const rows = runWa([{ key: 'legacy_x', label: 'Legacy Line', amount: 4321 }])
    const line = (rows[0].revenue.customRevenue || [])[0]
    expect(line.name).toBe('Legacy Line')
    expect(line.amount).toBe(4321)                                  // flat, Y1
    expect(rows[0].revenue.operatingRevenue).toBe(runWa([])[0].revenue.operatingRevenue + 4321) // recurring default true
  })

  test('no-custom WA regression: empty/absent lines produce identical output', () => {
    const empty = runWa([])
    const absent = runWa(undefined)
    expect(JSON.stringify(absent)).toBe(JSON.stringify(empty))
    expect(empty[0].revenue.customRevenue).toEqual([])
    expect(empty[0].revenue.operatingRevenue).toBe(empty[0].revenue.total - empty[0].revenue.interestIncome - empty[0].revenue.grantRevenue)
  })

  test('Generic isolation: WA-shaped custom line is invisible to the Generic engine', () => {
    const cfg = getStateConfig('generic_charter')
    const profNoCustom = waProfile(undefined)
    const profWaLine = waProfile([{ id: 'wa', name: 'WA Line', group: 'Other', driver: 'flat', amountY1: 75000, recurring: true }])
    const a = computeGenericProjections(profNoCustom, POSITIONS, PROJECTIONS, cfg, 0)
    const b = computeGenericProjections(profWaLine, POSITIONS, PROJECTIONS, cfg, 0)
    // The Generic engine only reads legacy keys; a WA-shaped line (no `key`) must not move its output.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  test('Generic reader still consumes a legacy per_pupil_funding line', () => {
    const cfg = getStateConfig('generic_charter')
    const def = computeGenericProjections(waProfile(undefined), POSITIONS, PROJECTIONS, cfg, 0)
    const withRate = computeGenericProjections(
      waProfile([{ key: 'per_pupil_funding', label: 'Per-Pupil Funding', amount: 100 * 12000 }]),
      POSITIONS, PROJECTIONS, cfg, 0,
    )
    // Default per-pupil rate is 10000; a legacy line setting 12000/student must raise Y1 operating revenue.
    expect(withRate[0].revenue.operatingRevenue).toBeGreaterThan(def[0].revenue.operatingRevenue)
  })
})
