import { test, expect } from '@playwright/test'
import { computeMultiYearDetailed, computeMonthlyCashFlow, type CashFlowMonth } from '../../src/lib/budgetEngine'
import { dailyCashExpense, fiveYearSeries, lowestPointIndex, monthlyCashSeries, reserveLines } from '../../src/lib/chartData'
import { compactMoney, niceTicks } from '../../src/components/charts/chartUtils'
import { confirmDiscardUnsaved, hasUnsavedChanges, setUnsaved, unsavedLabels } from '../../src/lib/unsavedChanges'
import { aiErrorMessage, splitStreamError } from '../../src/lib/aiErrors'
import { inferPositionType, resolvePositionType, savedCustomClassification } from '../../src/lib/positionTypes'
import { hashProjectionInputs, scenarioBaseHash } from '../../src/lib/buildSchoolContext'
import { DEFAULT_ASSUMPTIONS, type BudgetProjection, type SchoolProfile, type StaffingPosition } from '../../src/lib/types'

/**
 * Phase 4 (UX): chart data shaping, the unsaved-changes guard, AI failure messages,
 * Staffing position-type resolution (P-UX-12) and the shared scenario staleness hash.
 *
 * Run: npx playwright test tests/session4/phase4-ux.spec.ts
 */

function profile(): SchoolProfile {
  return {
    school_id: '00000000-0000-0000-0000-0000000004a1',
    region: 'Seattle', planned_open_year: 2027, grade_config: 'K-5',
    target_enrollment_y1: 120, target_enrollment_y2: 150, target_enrollment_y3: 180,
    target_enrollment_y4: 210, target_enrollment_y5: 240,
    max_class_size: 24, pct_frl: 55, pct_iep: 12, pct_ell: 10, pct_hicap: 5,
    onboarding_complete: true, retention_rate: 92,
    financial_assumptions: {},
    startup_funding: [],
  } as unknown as SchoolProfile
}
const POSITIONS: StaffingPosition[] = [
  { school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
  { school_id: 'x', year: 1, title: 'Teacher', category: 'certificated', fte: 6, annual_salary: 68000, position_type: 'teacher_elem', classification: 'Certificated', driver: 'per_pupil', students_per_position: 22 },
  { school_id: 'x', year: 2, title: 'Teacher', category: 'certificated', fte: 7, annual_salary: 69700, position_type: 'teacher_elem', classification: 'Certificated', driver: 'per_pupil', students_per_position: 22 },
]
const PROJECTIONS: BudgetProjection[] = [
  { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 180000, is_revenue: false },
  { school_id: 'x', year: 2, category: 'Operations', subcategory: 'Facilities', amount: 190000, is_revenue: false },
]

test.describe('chart axes', () => {
  test('niceTicks covers the data, includes zero and uses round steps', () => {
    const t = niceTicks(913_323, 1_509_463, 4)
    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(1_509_463)
    const step = t[1] - t[0]
    expect([250_000, 500_000]).toContain(step)
    t.forEach((v, i) => i && expect(v - t[i - 1]).toBeCloseTo(step))
  })

  test('niceTicks reaches below zero for a negative balance', () => {
    const t = niceTicks(-40_000, 300_000, 4)
    expect(t[0]).toBeLessThan(0)
    expect(t).toContain(0)
  })

  test('compactMoney keeps significant zeros', () => {
    expect(compactMoney(500_000)).toBe('$500K')
    expect(compactMoney(1_500_000)).toBe('$1.5M')
    expect(compactMoney(1_250_000)).toBe('$1.25M')
    expect(compactMoney(2_000_000)).toBe('$2M')
    expect(compactMoney(0)).toBe('$0')
    expect(compactMoney(-40_000)).toBe('−$40K')
  })
})

test.describe('chart data', () => {
  test('reserveLines draws the year\'s Days-of-Cash band in dollars', () => {
    const daily = dailyCashExpense(3_650_000, 0)
    expect(daily).toBe(10_000)
    const y1 = reserveLines(3_650_000, 0, 1, 'wa_charter')
    expect(y1.map((l) => [l.days, l.dollars, l.status])).toEqual([[30, 300_000, 'meets'], [21, 210_000, 'approaching']])
    expect(y1[0].label).toContain('Stage 1')
    const y3 = reserveLines(3_650_000, 0, 3, 'wa_charter')
    expect(y3.map((l) => l.days)).toEqual([60, 30])
    expect(reserveLines(3_650_000, 0, 1, 'generic').map((l) => l.days)).toEqual([60, 30])
    // Depreciation is excluded from the daily cash expense, as in computeDaysOfCash.
    expect(reserveLines(3_650_000 + 365_000, 365_000, 1, 'wa_charter')[0].dollars).toBe(300_000)
    expect(reserveLines(0, 0, 1, 'wa_charter')).toEqual([])
  })

  test('monthlyCashSeries reads each month-end balance against the band', () => {
    const months = [400_000, 250_000, 150_000, 600_000].map((bal, i) => ({ month: ['Sep', 'Oct', 'Nov', 'Dec'][i], cumulativeBalance: bal, netCashFlow: 0 }))
    const pts = monthlyCashSeries(months as CashFlowMonth[], 3_650_000, 0, 1, 'wa_charter')
    expect(pts.map((p) => p.status)).toEqual(['meets', 'approaching', 'fails', 'meets'])
    expect(pts[1].days).toBe(25)
    expect(lowestPointIndex(pts)).toBe(2)
    expect(lowestPointIndex([])).toBe(-1)
  })

  test('the chart plots the engine\'s own monthly model: August ends at year-end cash', () => {
    const p = profile()
    const rows = computeMultiYearDetailed(p, POSITIONS.filter((x) => x.year === 1), PROJECTIONS, DEFAULT_ASSUMPTIONS, 200_000, [], POSITIONS, [])
    const flow = computeMonthlyCashFlow(rows[0], 200_000, { pathway: 'wa_charter' })
    const pts = monthlyCashSeries(flow.months, rows[0].totalExpenses, rows[0].operations.depreciation ?? 0, 1, 'wa_charter')
    expect(pts).toHaveLength(12)
    expect(pts.map((x) => x.month)).toEqual(flow.months.map((m) => m.month))
    expect(Math.abs(pts[11].balance - rows[0].endingCash)).toBeLessThan(12)
    expect(flow.lowScheduleMonths).toEqual(['Nov', 'May'])
  })

  test('fiveYearSeries steps the WA target from 30 to 60 days at Stage 2', () => {
    const p = profile()
    const rows = computeMultiYearDetailed(p, POSITIONS.filter((x) => x.year === 1), PROJECTIONS, DEFAULT_ASSUMPTIONS, 200_000, [], POSITIONS, [])
    const s = fiveYearSeries(rows, 'wa_charter')
    expect(s.map((x) => x.targetDays)).toEqual([30, 30, 60, 60, 60])
    s.forEach((x, i) => {
      expect(x.revenue).toBe(rows[i].revenue.total)
      expect(x.expenses).toBe(rows[i].totalExpenses)
      expect(x.days).toBe(rows[i].reserveDays)
    })
    expect(fiveYearSeries(rows, 'generic').map((x) => x.targetDays)).toEqual([60, 60, 60, 60, 60])
  })
})

test.describe('unsaved-changes guard', () => {
  test.afterEach(() => { for (const id of ['a', 'b']) setUnsaved(id, '', false) })

  test('tracks dirty editors and asks once before discarding', () => {
    expect(hasUnsavedChanges()).toBe(false)
    expect(confirmDiscardUnsaved(() => { throw new Error('must not ask when clean') })).toBe(true)

    setUnsaved('a', 'Startup funding', true)
    setUnsaved('b', 'Custom revenue lines', true)
    expect(unsavedLabels()).toEqual(['Startup funding', 'Custom revenue lines'])

    let asked = ''
    expect(confirmDiscardUnsaved((m) => { asked = m; return false })).toBe(false)
    expect(asked).toContain('Startup funding, Custom revenue lines')
    expect(hasUnsavedChanges()).toBe(true) // cancelled: edits are kept

    expect(confirmDiscardUnsaved(() => true)).toBe(true)
    expect(hasUnsavedChanges()).toBe(false) // leaving: nothing asks again on the way out
  })

  test('clearing an editor removes it from the prompt', () => {
    setUnsaved('a', 'Staffing plan', true)
    setUnsaved('a', 'Staffing plan', false)
    expect(hasUnsavedChanges()).toBe(false)
  })
})

test.describe('AI failure messages', () => {
  test('every status maps to a visible message', () => {
    expect(aiErrorMessage(401)).toMatch(/session has expired/)
    expect(aiErrorMessage(403)).toMatch(/role/)
    expect(aiErrorMessage(429)).toMatch(/Too many/)
    expect(aiErrorMessage(503, 'AI temporarily unavailable — try again in a moment.')).toBe('AI temporarily unavailable — try again in a moment.')
    expect(aiErrorMessage(500, 'ANTHROPIC_API_KEY not configured')).toMatch(/not configured/)
    expect(aiErrorMessage(500, 'internal stack detail')).not.toContain('stack')
  })

  test('splitStreamError strips the /api/chat stream error marker', () => {
    expect(splitStreamError('Full answer.')).toEqual({ text: 'Full answer.', error: null })
    expect(splitStreamError('Partial answer\n\n[Error: overloaded]')).toEqual({ text: 'Partial answer', error: 'overloaded' })
    expect(splitStreamError('\n\n[Error: x [y] z]')).toEqual({ text: '', error: 'x [y] z' })
  })
})

test.describe('Staffing position types (P-UX-12)', () => {
  test('a custom position saved by the Staffing tab keeps its type and section', () => {
    const row = { title: 'Math Teacher', position_type: 'custom', students_per_position: 0, classification: 'Certificated' }
    expect(inferPositionType(row.title)).toBe('teacher_elem') // the old behavior re-typed it
    expect(resolvePositionType(row)).toBe('custom')
    expect(savedCustomClassification(row)).toBe('Certificated')
  })

  test('untyped older rows (column defaults) are still typed from their title', () => {
    const legacy = { title: 'Principal/Head of School', position_type: 'custom', students_per_position: 24, classification: 'Administrative' }
    expect(resolvePositionType(legacy)).toBe('principal')
    expect(savedCustomClassification(legacy)).toBeNull()
    expect(resolvePositionType({ title: 'Custodian', position_type: null })).toBe('custodian')
  })

  test('catalog types are used as saved', () => {
    expect(resolvePositionType({ title: 'Whatever', position_type: 'counselor', students_per_position: 0 })).toBe('counselor')
    expect(savedCustomClassification({ position_type: 'counselor', students_per_position: 0, classification: 'Classified' })).toBeNull()
    expect(savedCustomClassification({ position_type: 'custom', students_per_position: 0, classification: 'Instructional' })).toBeNull()
  })
})

test('scenarioBaseHash is the hash /api/scenarios/calculate stores', () => {
  const p = profile()
  const expected = hashProjectionInputs({ profile: p, positions: POSITIONS, projections: PROJECTIONS.filter((x) => x.year === 1), gradeExpansionPlan: [] })
  expect(scenarioBaseHash({ profile: p, allPositions: POSITIONS, projections: PROJECTIONS, gradeExpansionPlan: [] })).toBe(expected)
})
