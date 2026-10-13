import { test, expect } from '@playwright/test'
import {
  evaluatePersonnelPctHealth,
  getPersonnelHealthBand,
  personnelHealthBandsForPrompt,
  evaluatePersonnelPct,
  evaluateDaysOfCash,
  evaluateTotalMargin,
  evaluateThreeYearMargin,
  evaluateCurrentRatio,
  evaluateCashFlow,
  evaluateEnrollmentVariance,
  evaluateBreakEvenPct,
  evaluateFinancialAidPct,
  getDaysOfCashBand,
  getTotalMarginBand,
  getThreeYearMarginBand,
  getCurrentRatioBand,
  getCashFlowBand,
  getEnrollmentVarianceBand,
  getFacilityPctBand,
  getGenericPersonnelBand,
  getBreakEvenPctBand,
  getFinancialAidPctBand,
  toFpfStatus,
  toGenericColor,
  fpfThresholdsForPrompt,
  genericHealthBandsForPrompt,
  facilityHealthBandsForPrompt,
  type HealthEvaluation,
} from '../../src/lib/healthThresholds'
import {
  computeFPFScorecard,
  computeGenericHealthScorecard,
  runProjections,
  computeCarryForward,
  type MultiYearDetailedRow,
} from '../../src/lib/budgetEngine'
import { getStateConfig } from '../../src/lib/stateConfig'
import { getGenericAgents, getGenericBriefingPrompt } from '../../src/lib/genericAgents'
import { DEFAULT_ASSUMPTIONS, type SchoolProfile, type StaffingPosition, type BudgetProjection } from '../../src/lib/types'

/**
 * Suite — Personnel-% health threshold helper (F-001 / F-011 fix).
 *
 * Pure-function contract tests. The helper is the single source of truth for
 * personnel-% verdict logic across:
 *   - Overview tile
 *   - Staffing tab UI copy
 *   - Staffing Advisor agent prompt (via injection)
 *   - Ask SchoolLaunch agent prompt (via injection)
 *   - PDF export
 *
 * REPRESENTATION NOTE: pct is an integer percentage (65, 72, 78), not a decimal
 * fraction (0.65, 0.72, 0.78). All callers must use the same representation.
 */

test.describe('getPersonnelHealthBand — year-aware band selection', () => {
  test('Year 1 returns founding band (65–72%)', () => {
    const band = getPersonnelHealthBand(1)
    expect(band.yearCategory).toBe('founding')
    expect(band.meetsLower).toBe(65)
    expect(band.meetsUpper).toBe(72)
    expect(band.approachingLow).toBe(62)
    expect(band.approachingHigh).toBe(75)
    expect(band.label).toBe('Founding year 65–72%')
  })

  test('Year 2 returns steady-state band (72–78%)', () => {
    const band = getPersonnelHealthBand(2)
    expect(band.yearCategory).toBe('steady_state')
    expect(band.meetsLower).toBe(72)
    expect(band.meetsUpper).toBe(78)
    expect(band.approachingLow).toBe(69)
    expect(band.approachingHigh).toBe(81)
    expect(band.label).toBe('Steady-state 72–78%')
  })

  test('Year 3, 4, 5 all return steady-state band', () => {
    for (const year of [3, 4, 5]) {
      expect(getPersonnelHealthBand(year).yearCategory).toBe('steady_state')
    }
  })
})

test.describe('evaluatePersonnelPctHealth — Year 1 founding boundaries', () => {
  // Founding band: meets 65–72, approaching 62–65 or 72–75, fails outside
  test('65.3% (the Evergreen Heights audit case) → meets', () => {
    const result = evaluatePersonnelPctHealth(65.3, 1)
    expect(result.verdict).toBe('meets')
    expect(result.short).toBe('Within founding-year range')
  })

  test('exactly 65% → meets (inclusive lower boundary)', () => {
    expect(evaluatePersonnelPctHealth(65, 1).verdict).toBe('meets')
  })

  test('exactly 72% → meets (inclusive upper boundary)', () => {
    expect(evaluatePersonnelPctHealth(72, 1).verdict).toBe('meets')
  })

  test('64.9% → approaching low', () => {
    const result = evaluatePersonnelPctHealth(64.9, 1)
    expect(result.verdict).toBe('approaching')
    expect(result.short).toBe('Approaching low')
  })

  test('exactly 62% → approaching low (inclusive lower of approaching)', () => {
    expect(evaluatePersonnelPctHealth(62, 1).verdict).toBe('approaching')
  })

  test('61.9% → fails (below approaching range)', () => {
    const result = evaluatePersonnelPctHealth(61.9, 1)
    expect(result.verdict).toBe('fails')
    expect(result.short).toBe('Below healthy range')
  })

  test('72.1% → approaching high', () => {
    const result = evaluatePersonnelPctHealth(72.1, 1)
    expect(result.verdict).toBe('approaching')
    expect(result.short).toBe('Approaching high')
  })

  test('exactly 75% → approaching high (inclusive upper of approaching)', () => {
    expect(evaluatePersonnelPctHealth(75, 1).verdict).toBe('approaching')
  })

  test('75.1% → fails (above approaching range)', () => {
    const result = evaluatePersonnelPctHealth(75.1, 1)
    expect(result.verdict).toBe('fails')
    expect(result.short).toBe('Above healthy range')
  })
})

test.describe('evaluatePersonnelPctHealth — Year 2+ steady-state boundaries', () => {
  // Steady-state band: meets 72–78, approaching 69–72 or 78–81, fails outside
  test('75% in Y3 → meets (mid-range)', () => {
    expect(evaluatePersonnelPctHealth(75, 3).verdict).toBe('meets')
  })

  test('exactly 72% in Y3 → meets', () => {
    expect(evaluatePersonnelPctHealth(72, 3).verdict).toBe('meets')
  })

  test('exactly 78% in Y3 → meets', () => {
    expect(evaluatePersonnelPctHealth(78, 3).verdict).toBe('meets')
  })

  test('71.9% in Y3 → approaching low', () => {
    expect(evaluatePersonnelPctHealth(71.9, 3).verdict).toBe('approaching')
    expect(evaluatePersonnelPctHealth(71.9, 3).short).toBe('Approaching low')
  })

  test('exactly 69% in Y3 → approaching', () => {
    expect(evaluatePersonnelPctHealth(69, 3).verdict).toBe('approaching')
  })

  test('68.9% in Y3 → fails (below approaching)', () => {
    expect(evaluatePersonnelPctHealth(68.9, 3).verdict).toBe('fails')
  })

  test('78.1% in Y3 → approaching high', () => {
    expect(evaluatePersonnelPctHealth(78.1, 3).verdict).toBe('approaching')
    expect(evaluatePersonnelPctHealth(78.1, 3).short).toBe('Approaching high')
  })

  test('exactly 81% in Y3 → approaching', () => {
    expect(evaluatePersonnelPctHealth(81, 3).verdict).toBe('approaching')
  })

  test('81.1% in Y3 → fails (above approaching)', () => {
    expect(evaluatePersonnelPctHealth(81.1, 3).verdict).toBe('fails')
  })

  test('65.3% in Y3 → fails (regression: this is healthy in Y1 but NOT in Y3)', () => {
    const result = evaluatePersonnelPctHealth(65.3, 3)
    expect(result.verdict).toBe('fails')
    expect(result.short).toBe('Below healthy range')
  })
})

test.describe('evaluatePersonnelPctHealth — band differentiation', () => {
  test('same pct (70%) reaches different verdicts in Y1 vs Y3', () => {
    // 70% sits inside the founding meets band but inside the steady-state approaching-low band
    expect(evaluatePersonnelPctHealth(70, 1).verdict).toBe('meets')
    expect(evaluatePersonnelPctHealth(70, 3).verdict).toBe('approaching')
  })

  test('long-form explanation cites the year-appropriate band', () => {
    const y1 = evaluatePersonnelPctHealth(70, 1).long
    const y3 = evaluatePersonnelPctHealth(70, 3).long
    expect(y1).toContain('founding year')
    expect(y3).toContain('steady-state')
  })
})

test.describe('personnelHealthBandsForPrompt — single source for AI prompts', () => {
  test('output contains both year-aware bands', () => {
    const text = personnelHealthBandsForPrompt()
    expect(text).toContain('Year 1 (founding)')
    expect(text).toContain('Year 2+ (steady-state)')
    expect(text).toContain('65–72%')
    expect(text).toContain('72–78%')
  })

  test('output warns against citing steady-state as Y1 standard', () => {
    const text = personnelHealthBandsForPrompt()
    expect(text).toMatch(/DO NOT/)
    expect(text).toMatch(/founding/i)
  })
})

// ---------------------------------------------------------------------------
// R-HEALTH-01 parity: the scorecards, the evaluators and the prompt text share one set of bands.
// ---------------------------------------------------------------------------

/**
 * Synthetic engine rows with controlled cash: expenses $365,000/yr ($1,000/day, no
 * depreciation), starting cash $0, so Days of Cash = cumulative net / 1,000.
 * Days: Y1 25 (Stage 1 approaching), Y2 35 (Stage 1 meets), Y3 45 (Stage 2 approaching,
 * would meet Stage 1), Y4 70 (Stage 2 meets), Y5 20 (Stage 2 fails).
 */
function syntheticRows(): MultiYearDetailedRow[] {
  const nets = [25000, 10000, 10000, 25000, -50000]
  const operating = [390000, 360000, 375000, 400000, 300000]
  return nets.map((net, i) => ({
    year: i + 1,
    enrollment: 100,
    revenue: { operatingRevenue: operating[i], total: 365000 + net },
    operations: {},
    totalExpenses: 365000,
    net,
  })) as unknown as MultiYearDetailedRow[]
}

const SCHOOL: SchoolProfile = {
  school_id: 'x', region: 'Seattle', planned_open_year: 2027, grade_config: 'K-5',
  target_enrollment_y1: 150, target_enrollment_y2: 200, target_enrollment_y3: 250,
  target_enrollment_y4: 300, target_enrollment_y5: 350, max_class_size: 24,
  pct_frl: 45, pct_iep: 12, pct_ell: 10, pct_hicap: 5, onboarding_complete: true,
  financial_assumptions: {}, startup_funding: [{ source: 'CSP Grant', amount: 250000, type: 'grant', status: 'pledged' }],
  retention_rate: 90, opening_grades: ['K', '1', '2'], buildout_grades: ['3', '4', '5'],
} as unknown as SchoolProfile
const SCHOOL_POSITIONS: StaffingPosition[] = [
  { school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
  { school_id: 'x', year: 1, title: 'Teacher', category: 'certificated', fte: 6, annual_salary: 70000, position_type: 'teacher_elem', classification: 'Instructional', driver: 'per_pupil_elem', students_per_position: 24 },
]
const SCHOOL_PROJECTIONS: BudgetProjection[] = [
  { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 180000, is_revenue: false },
]
const engineRows = (pathway?: string) => runProjections({
  pathway, profile: SCHOOL, positions: SCHOOL_POSITIONS, projections: SCHOOL_PROJECTIONS,
  assumptions: DEFAULT_ASSUMPTIONS, preOpenCash: computeCarryForward(SCHOOL),
})

/** The evaluator that classifies each FPF measure (null for the measures with fixed statuses). */
const FPF_EVALUATORS: Record<string, ((v: number | null, year: number) => HealthEvaluation) | null> = {
  'Current Ratio': (v, y) => evaluateCurrentRatio(v, y),
  'Days of Cash': (v, y) => evaluateDaysOfCash(v, y),
  'Total Margin': (v, y) => evaluateTotalMargin(v, y),
  '3-Year Total Margin': (v, y) => evaluateThreeYearMargin(v, y),
  'Cash Flow': (v, y) => evaluateCashFlow(v, y),
  'Multi-Year Cash Flow': (v, y) => evaluateCashFlow(v, y),
  'Enrollment Variance': (v, y) => evaluateEnrollmentVariance(v, y),
  'Debt-to-Asset': null,
  'Debt Default': null,
}

function expectFpfParity(rows: MultiYearDetailedRow[], startingCash: number) {
  const sc = computeFPFScorecard(rows, startingCash, false)
  for (const m of sc.measures) {
    expect(Object.keys(FPF_EVALUATORS), `unmapped measure ${m.name}`).toContain(m.name)
    const evaluate = FPF_EVALUATORS[m.name]
    if (!evaluate) continue
    m.values.forEach((v, i) => {
      expect(m.statuses[i], `${m.name} Y${i + 1}`).toBe(toFpfStatus(evaluate(v, i + 1).status))
    })
  }
  return sc
}

test.describe('R-HEALTH-01 — FPF scorecard statuses equal the evaluators (both stages)', () => {
  test('synthetic rows exercise every Days of Cash verdict across Stage 1 and Stage 2', () => {
    const sc = expectFpfParity(syntheticRows(), 0)
    const days = sc.measures.find((m) => m.name === 'Days of Cash')!
    expect(days.values).toEqual([25, 35, 45, 70, 20])
    expect(days.statuses).toEqual(['approaches', 'meets', 'approaches', 'meets', 'does_not_meet'])
    // 45 days meets Stage 1 but only approaches Stage 2: the stage switch happens at Year 3.
    expect(evaluateDaysOfCash(45, 2).status).toBe('meets')
    expect(evaluateDaysOfCash(45, 3).status).toBe('approaching')
  })

  test('a real engine run matches the evaluators in every year', () => {
    const rows = engineRows()
    expect(rows).toHaveLength(5)
    expectFpfParity(rows, computeCarryForward(SCHOOL))
  })

  test('scorecard target strings are the bands\' targets', () => {
    const sc = computeFPFScorecard(syntheticRows(), 0, false)
    const byName = (n: string) => sc.measures.find((m) => m.name === n)!
    expect(byName('Days of Cash').stage1Target).toBe(getDaysOfCashBand(1).target)
    expect(byName('Days of Cash').stage2Target).toBe(getDaysOfCashBand(3).target)
    expect(byName('Days of Cash').stage1Approaching).toBe(getDaysOfCashBand(1).approachingRange)
    expect(byName('Current Ratio').stage2Target).toBe(getCurrentRatioBand(3).target)
    expect(byName('Total Margin').stage1Target).toBe(getTotalMarginBand(1).target)
    expect(byName('3-Year Total Margin').stage2Target).toBe(getThreeYearMarginBand().target)
    expect(byName('Cash Flow').stage2Target).toBe(getCashFlowBand(3).target)
    expect(byName('Enrollment Variance').stage1Target).toBe(getEnrollmentVarianceBand(1).target)
  })
})

test.describe('R-HEALTH-01 — generic scorecard colors equal toGenericColor(evaluator)', () => {
  test('every measure, every year (tuition pathway, including financial aid)', () => {
    const config = getStateConfig('generic_private')
    const rows = engineRows('generic_private')
    const sc = computeGenericHealthScorecard(rows, computeCarryForward(SCHOOL), config, 12000, 0.2)
    const evaluators: Record<string, (v: number, year: number) => HealthEvaluation> = {
      'Reserve Days (Cash on Hand)': (v, y) => evaluateDaysOfCash(v, y, 'generic'),
      'Personnel % of Revenue': (v, y) => evaluatePersonnelPct(v, y, 'generic'),
      'Total Margin (Net / Revenue)': (v, y) => evaluateTotalMargin(v, y, 'generic'),
      'Break-Even Enrollment': (v) => evaluateBreakEvenPct(v),
      'Current Ratio': (v, y) => evaluateCurrentRatio(v, y, 'generic'),
      'Financial Aid % of Tuition': (v) => evaluateFinancialAidPct(v),
    }
    expect(sc.measures.map((m) => m.name)).toEqual(Object.keys(evaluators))
    for (const m of sc.measures) {
      for (const v of m.values) {
        expect(v.status, `${m.name} Y${v.year}`).toBe(toGenericColor(evaluators[m.name](v.value, v.year).status))
      }
    }
  })

  test('healthy/watch/concern labels are the generic bands', () => {
    const sc = computeGenericHealthScorecard(engineRows('generic_charter'), 0, getStateConfig('generic_charter'))
    const labels = (n: string) => {
      const m = sc.measures.find((x) => x.name === n)!
      return [m.healthy, m.watch, m.concern]
    }
    const band = (b: { target: string; approachingRange: string; concern: string }) => [b.target, b.approachingRange, b.concern]
    expect(labels('Reserve Days (Cash on Hand)')).toEqual(band(getDaysOfCashBand(1, 'generic')))
    expect(labels('Personnel % of Revenue')).toEqual(band(getGenericPersonnelBand()))
    expect(labels('Total Margin (Net / Revenue)')).toEqual(band(getTotalMarginBand(1, 'generic')))
    expect(labels('Break-Even Enrollment')).toEqual(band(getBreakEvenPctBand()))
    expect(labels('Current Ratio')).toEqual(band(getCurrentRatioBand(1, 'generic')))
  })
})

test.describe('R-HEALTH-01 — prompt helpers quote the same numbers as the bands', () => {
  test('fpfThresholdsForPrompt carries every Stage 1 / Stage 2 band', () => {
    const text = fpfThresholdsForPrompt()
    for (const b of [getDaysOfCashBand(1), getDaysOfCashBand(3), getCurrentRatioBand(1), getCurrentRatioBand(3), getTotalMarginBand(1), getThreeYearMarginBand(), getCashFlowBand(3), getEnrollmentVarianceBand(1)]) {
      expect(text).toContain(b.target)
      expect(text).toContain(b.approachingRange)
    }
    expect(text).toContain('Stage 1 = Years 1–2')
  })

  test('genericHealthBandsForPrompt carries every generic band', () => {
    const text = genericHealthBandsForPrompt()
    for (const b of [getDaysOfCashBand(1, 'generic'), getGenericPersonnelBand(), getTotalMarginBand(1, 'generic'), getBreakEvenPctBand(), getCurrentRatioBand(1, 'generic'), getFinancialAidPctBand()]) {
      expect(text).toContain(`healthy ${b.target}, watch ${b.approachingRange}, concern ${b.concern}`)
    }
  })

  test('facilityHealthBandsForPrompt carries the facility band', () => {
    const f = getFacilityPctBand()
    const text = facilityHealthBandsForPrompt()
    expect(text).toContain(f.target)
    expect(text).toContain(f.approachingRange)
    expect(text).toContain(f.concern.toLowerCase())
  })

  test('personnelHealthBandsForPrompt quotes both personnel bands\' edges', () => {
    const text = personnelHealthBandsForPrompt()
    for (const b of [getPersonnelHealthBand(1), getPersonnelHealthBand(2)]) {
      expect(text).toContain(`healthy ${b.meetsLower}–${b.meetsUpper}%`)
      expect(text).toContain(`Below ${b.approachingLow}%`)
      expect(text).toContain(`above ${b.approachingHigh}%`)
    }
  })

  test('generic agent prompts use the generic bands, not the old 65–78% personnel band', () => {
    for (const type of ['charter', 'private', 'micro']) {
      const agents = getGenericAgents(type)
      const prompt = (id: string) => agents.find((a) => a.id === id)!.systemPrompt
      const p = getGenericPersonnelBand()
      expect(prompt('financial_health')).toContain(genericHealthBandsForPrompt())
      expect(prompt('staffing_advisor')).toContain(`healthy ${p.target}, watch ${p.approachingRange}`)
      expect(prompt('staffing_advisor')).not.toContain('65-78%')
      expect(prompt('operations_analyst')).toContain(facilityHealthBandsForPrompt())
      expect(prompt('board_finance_chair')).toContain(getDaysOfCashBand(1, 'generic').target)
      expect(getGenericBriefingPrompt(type)).toContain(`above ${getBreakEvenPctBand().approachingAt}% of projected enrollment`)
    }
  })
})

test.describe('R-HEALTH-01 — founding vs steady-state personnel bands (WA) vs the generic band', () => {
  test('WA: Year 1 uses the founding band, Year 2+ the steady-state band', () => {
    expect(evaluatePersonnelPct(70, 1).status).toBe('meets')
    expect(evaluatePersonnelPct(70, 2).status).toBe('approaching')
    expect(evaluatePersonnelPct(68, 2).status).toBe('fails')
    expect(evaluatePersonnelPct(76, 1).status).toBe('fails')
    expect(evaluatePersonnelPct(76, 2).status).toBe('meets')
    expect(evaluatePersonnelPct(60, 1).status).toBe('fails')
    expect(evaluatePersonnelPct(68, 1).band.target).toBe('65–72%')
    expect(evaluatePersonnelPct(68, 3).band.target).toBe('72–78%')
    // The WA path delegates to evaluatePersonnelPctHealth (same verdict and short label).
    for (const [pct, year] of [[64, 1], [70, 1], [74, 1], [70, 3], [80, 3], [82, 3]]) {
      const e = evaluatePersonnelPctHealth(pct, year)
      expect(evaluatePersonnelPct(pct, year).status).toBe(e.verdict)
      expect(evaluatePersonnelPct(pct, year).short).toBe(e.short)
    }
  })

  test('generic: one band in every year (<75 healthy, 75–80 watch, >80 concern)', () => {
    for (const year of [1, 3]) {
      expect(evaluatePersonnelPct(60, year, 'generic').status).toBe('meets')
      expect(evaluatePersonnelPct(75, year, 'generic').status).toBe('approaching')
      expect(evaluatePersonnelPct(80, year, 'generic').status).toBe('approaching')
      expect(evaluatePersonnelPct(80.1, year, 'generic').status).toBe('fails')
    }
  })

  test('no value -> na (e.g. no revenue yet)', () => {
    expect(evaluatePersonnelPct(null, 1).status).toBe('na')
    expect(evaluatePersonnelPct(null, 1, 'generic').status).toBe('na')
  })
})
