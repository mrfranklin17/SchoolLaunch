import { test, expect } from '@playwright/test'
import {
  computeMultiYearDetailed,
  computeGenericProjections,
  computeFPFScorecard,
  computeMonthlyCashFlow,
  computeCarryForward,
  runProjections,
  benefitsRateFor,
  benefitsPctFor,
  fiscalMonthLabels,
  fiscalYearStartMonthFor,
  genericScorecardFor,
  MONTHS,
  type ProjectionInputs,
} from '../../src/lib/budgetEngine'
import { computeScenarioProjections, scenarioMeetsCount, scenarioStatusKeys, type ScenarioAssumptions } from '../../src/lib/scenarioEngine'
import { portfolioHealthFor } from '../../src/lib/portfolioHealth'
import { buildPortfolioPdfHtml, type PortfolioSchoolMetrics } from '../../src/lib/portfolioPdf'
import { buildAgentContextString, buildSchoolContextString } from '../../src/lib/buildSchoolContext'
import { buildNarrativeHtml, type NarrativePayload } from '../../src/app/api/export/narrative/route'
import { GENERIC_KNOWLEDGE } from '../../src/app/api/chat/route'
import { calcBenefits } from '../../src/lib/calculations'
import { fpfIssuesForStage, fromFpfStatus, fromGenericColor, genericIssuesForYears } from '../../src/lib/healthThresholds'
import { getStateConfig } from '../../src/lib/stateConfig'
import { DEFAULT_ASSUMPTIONS, getAssumptions, type SchoolProfile, type StaffingPosition, type BudgetProjection } from '../../src/lib/types'

/**
 * P2-FU-03 — generic-pathway gaps outside the dashboard:
 * (a) Scenarios run the school's pathway engine and grade on its scorecard;
 * (b) the admin portfolio grades generic schools on the generic health scorecard;
 * (c) monthly labels follow the fiscal-year start month (generic_charter: July);
 * (d) the generic engine honors the Settings interest rate (default 3% = the old fixed rate);
 * (e) displays, exports and AI context price benefits at the engine's load.
 * WA behaviour is pinned unchanged throughout.
 *
 * Run: npx playwright test tests/session4/generic-pathway-gaps.spec.ts
 */

const POSITIONS: StaffingPosition[] = [
  { school_id: 's', year: 1, title: 'Executive Director', category: 'admin', fte: 1, annual_salary: 110000, position_type: 'executive_director', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
  { school_id: 's', year: 1, title: 'Teacher', category: 'certificated', fte: 6, annual_salary: 60000, position_type: 'teacher_elem', classification: 'Instructional', driver: 'per_pupil', students_per_position: 22 },
  { school_id: 's', year: 1, title: 'Paraeducator', category: 'classified', fte: 2, annual_salary: 32000, position_type: 'paraeducator', classification: 'Instructional', driver: 'per_pupil', students_per_position: 48 },
]
const PROJECTIONS: BudgetProjection[] = [
  ['Facilities', 150000], ['Supplies & Materials', 24000], ['Technology', 18000], ['Insurance', 15000], ['Curriculum & Materials', 40000],
].map(([sub, amount]) => ({ school_id: 's', year: 1, category: 'Operations', subcategory: sub as string, amount: amount as number, is_revenue: false }))

function profile(extra: Record<string, unknown> = {}): SchoolProfile {
  return {
    school_id: 's', region: 'Portland', planned_open_year: 2027, grade_config: 'K-5',
    target_enrollment_y1: 120, target_enrollment_y2: 150, target_enrollment_y3: 180, target_enrollment_y4: 210, target_enrollment_y5: 240,
    max_class_size: 24, pct_frl: 55, pct_iep: 12, pct_ell: 10, pct_hicap: 5,
    onboarding_complete: true, retention_rate: 92,
    financial_assumptions: {},
    startup_funding: [{ source: 'Grant', amount: 200000, type: 'grant', status: 'received', selectedYears: [1], yearAllocations: { 1: 200000 } }],
    custom_revenue_lines: [
      { key: 'per_pupil_funding', label: 'Per-Pupil Funding', amount: 1_320_000 },
      { key: 'fundraising', label: 'Fundraising', amount: 30000 },
    ],
    tuition_rate: 14000, financial_aid_pct: 0.1,
    ...extra,
  } as unknown as SchoolProfile
}

function inputs(pathway: string, p: SchoolProfile = profile(), preOpenCash = 250000): ProjectionInputs {
  return { pathway, profile: p, positions: POSITIONS, projections: PROJECTIONS, assumptions: getAssumptions(p.financial_assumptions), preOpenCash, gradeExpansionPlan: [], allPositions: POSITIONS, startupFunding: p.startup_funding }
}

const BASE_LEVERS = (p: SchoolProfile): ScenarioAssumptions => ({
  enrollment_fill_rate: 1, per_pupil_funding_adjustment: 0, personnel_cost_adjustment: 0,
  facility_cost_monthly: 150000 / 12, startup_capital: computeCarryForward(p),
})

// --- (c) Fiscal-year month labels --------------------------------------------------------

test.describe('fiscal-year month labels', () => {
  test('labels rotate from the start month; September gives MONTHS', () => {
    expect(fiscalMonthLabels(9)).toEqual(MONTHS)
    expect(fiscalMonthLabels(7)).toEqual(['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
    expect(fiscalMonthLabels(1)[11]).toBe('Dec')
  })

  test('start month: WA always September; others the profile month, else the pathway default', () => {
    expect(fiscalYearStartMonthFor('wa_charter', 7)).toBe(9)
    expect(fiscalYearStartMonthFor(null, 7)).toBe(9)
    expect(fiscalYearStartMonthFor('generic_charter')).toBe(7)
    expect(fiscalYearStartMonthFor('generic_charter', null)).toBe(7)
    expect(fiscalYearStartMonthFor('generic_charter', 10)).toBe(10)
    expect(fiscalYearStartMonthFor('generic_charter', 13)).toBe(7)
    expect(fiscalYearStartMonthFor('generic_private')).toBe(9)
    expect(fiscalYearStartMonthFor('generic_micro', 7)).toBe(7)
  })

  test('generic_charter cash flow runs Jul–Jun; amounts do not depend on the labels', () => {
    const row = runProjections(inputs('generic_charter'))[0]
    const jul = computeMonthlyCashFlow(row, 250000, { pathway: 'generic_charter' })
    expect(jul.months.map((m) => m.month)).toEqual(fiscalMonthLabels(7))
    const sep = computeMonthlyCashFlow(row, 250000, { pathway: 'generic_charter', fiscalYearStartMonth: 9 })
    expect(sep.months.map((m) => m.month)).toEqual(MONTHS)
    expect(jul.months.map((m) => m.totalInflow)).toEqual(sep.months.map((m) => m.totalInflow))
    expect(jul.endingCash).toBe(sep.endingCash)
  })

  test('a July-start tuition school names its two no-collection months May and June', () => {
    const p = profile()
    const row = runProjections(inputs('generic_private', p))[0]
    const cf = computeMonthlyCashFlow(row, 250000, { pathway: 'generic_private', fiscalYearStartMonth: 7 })
    expect(cf.lowScheduleMonths).toEqual(['May', 'Jun'])
    expect(computeMonthlyCashFlow(row, 250000, { pathway: 'generic_private' }).lowScheduleMonths).toEqual(['Jul', 'Aug'])
  })

  test('BP1-FU-03: Ask SchoolLaunch describes tuition collection by fiscal month, not Sep–Jun', () => {
    for (const type of ['private', 'micro']) {
      const k = GENERIC_KNOWLEDGE(type)
      expect(k).toContain('first 10 months of the school\'s fiscal year')
      expect(k).not.toMatch(/September-June|July and August/)
    }
    expect(GENERIC_KNOWLEDGE('charter')).not.toContain('Tuition is collected')
  })

  test('WA ignores the profile month: Sep–Aug, Nov and May low', () => {
    const p = profile()
    const row = computeMultiYearDetailed(p, POSITIONS, PROJECTIONS, DEFAULT_ASSUMPTIONS, 250000, [], POSITIONS, p.startup_funding)[0]
    const base = computeMonthlyCashFlow(row, 250000, { pathway: 'wa_charter' })
    const withMonth = computeMonthlyCashFlow(row, 250000, { pathway: 'wa_charter', fiscalYearStartMonth: 7 })
    expect(withMonth).toEqual(base)
    expect(base.months.map((m) => m.month)).toEqual(MONTHS)
    expect(base.lowScheduleMonths).toEqual(['Nov', 'May'])
  })
})

// --- (d) Generic interest rate ------------------------------------------------------------

test.describe('generic engine interest rate', () => {
  test('default 3% (the old fixed rate): half a year on opening cash in Year 1', () => {
    const rows = runProjections(inputs('generic_charter'))
    expect(rows[0].revenue.interestIncome).toBe(Math.round(250000 * 0.03 / 2))
    expect(rows[1].revenue.interestIncome).toBe(Math.round(Math.max(0, rows[0].cumulativeNet) * 0.03))
  })

  test('the Settings rate is honored, via runProjections and directly from the profile', () => {
    const p = profile({ financial_assumptions: { interest_rate_on_cash: 5 } })
    const viaRun = runProjections(inputs('generic_charter', p))
    expect(viaRun[0].revenue.interestIncome).toBe(Math.round(250000 * 0.05 / 2))
    const direct = computeGenericProjections(p, POSITIONS, PROJECTIONS, getStateConfig('generic_charter'), 250000, [], POSITIONS, p.startup_funding)
    expect(direct).toEqual(viaRun)
  })
})

// --- (e) Benefits load --------------------------------------------------------------------

test.describe('benefits load: the engine’s rate everywhere', () => {
  test('WA reads Settings; other pathways the pathway load', () => {
    const a = { benefits_load_pct: 33.33 }
    expect(benefitsRateFor('wa_charter', a)).toBe(33.33 / 100)
    expect(benefitsPctFor('wa_charter', a)).toBe(33.33)
    expect(benefitsRateFor(undefined, a)).toBe(33.33 / 100)
    expect(benefitsRateFor('generic_charter', a)).toBe(0.25)
    expect(benefitsPctFor('generic_charter', a)).toBe(25)
    expect(benefitsPctFor('generic_micro', a)).toBe(20)
  })

  test('the generic engine’s benefits equal the positions priced at benefitsRateFor', () => {
    const p = profile()
    const row = runProjections(inputs('generic_charter', p))[0]
    const rate = benefitsRateFor('generic_charter', getAssumptions(p.financial_assumptions))
    expect(row.personnel.benefits).toBe(POSITIONS.reduce((s, x) => s + Math.round(x.fte * x.annual_salary * rate), 0))
  })

  test('AI context prices generic positions at the pathway load, WA at the Settings load', () => {
    const p = profile()
    const teacher = POSITIONS[1]
    const cost = teacher.annual_salary * teacher.fte
    const generic = cost + calcBenefits(cost, 0.25)
    const wa = cost + calcBenefits(cost, 0.30)
    const gAgent = buildAgentContextString('S', p, POSITIONS, PROJECTIONS, [], undefined, undefined, 'generic_charter')
    const gSchool = buildSchoolContextString('S', p, POSITIONS, PROJECTIONS, [], undefined, undefined, 'generic_charter')
    expect(gAgent).toContain(`total with benefits: $${generic.toLocaleString()}`)
    expect(gSchool).toContain(`total cost with benefits: $${generic.toLocaleString()}`)
    const wAgent = buildAgentContextString('S', p, POSITIONS, PROJECTIONS, [], undefined, undefined, 'wa_charter')
    expect(wAgent).toContain(`total with benefits: $${wa.toLocaleString()}`)
  })
})

// --- (a) Scenarios on the school's pathway ----------------------------------------------------

test.describe('scenario engine by pathway', () => {
  const levers: ScenarioAssumptions = { enrollment_fill_rate: 0.85, per_pupil_funding_adjustment: -0.05, personnel_cost_adjustment: 0.05, facility_cost_monthly: 14000, startup_capital: 220000 }

  test('WA: the pathway argument changes nothing (byte-identical results)', () => {
    const p = profile()
    const none = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], levers)
    const wa = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], levers, 'wa_charter')
    expect(wa).toEqual(none)
    expect(wa.genericScorecard).toBeNull()
    expect(wa.multiYear[0].revenue.regularEd).toBeGreaterThan(0)
    expect(wa.results.years['1'].fpf_enrollment_variance).toBe('approaches') // 85% fill: Commission band
  })

  test('generic: neutral levers reproduce the dashboard’s engine run and generic scorecard', () => {
    const p = profile()
    const out = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], BASE_LEVERS(p), 'generic_charter')
    const base = runProjections(inputs('generic_charter', p, computeCarryForward(p)))
    expect(out.multiYear).toEqual(base)
    expect(out.genericScorecard).toEqual(genericScorecardFor(base, computeCarryForward(p), getStateConfig('generic_charter'), p))
    expect(out.results.years['1'].total_revenue).toBe(base[0].revenue.total)
  })

  test('generic: results are graded on the generic health benchmarks', () => {
    const p = profile()
    const out = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], levers, 'generic_charter')
    const g = out.genericScorecard!
    const colors = (name: string) => g.measures.find((m) => m.name === name)!.values.map((v) => fromGenericColor(v.status))
    const stored = (k: string) => [1, 2, 3, 4, 5].map((y) => fromFpfStatus((out.results.years[String(y)] as unknown as Record<string, string>)[k]))
    expect(stored('fpf_days_cash')).toEqual(colors('Reserve Days (Cash on Hand)'))
    expect(stored('fpf_current_ratio')).toEqual(colors('Current Ratio'))
    expect(stored('fpf_total_margin')).toEqual(colors('Total Margin (Net / Revenue)'))
    expect(stored('fpf_enrollment_variance')).toEqual(['na', 'na', 'na', 'na', 'na'])
    const y1 = out.results.years['1']
    expect(y1.total_margin).toBe(g.measures.find((m) => m.name === 'Total Margin (Net / Revenue)')!.values[0].value)
    // The breakdown sums to total revenue (fees, fundraising and interest are "other").
    expect(y1.regular_ed_revenue + y1.startup_grants + y1.other_revenue).toBe(y1.total_revenue)
    expect(y1.sped_revenue + y1.federal_categorical + y1.small_school_enhancement).toBe(0)
  })

  test('generic per-pupil: fill rate holds the per-student rate; funding lever moves it', () => {
    const p = profile()
    const base = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], BASE_LEVERS(p), 'generic_charter').multiYear[0]
    const filled = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], { ...BASE_LEVERS(p), enrollment_fill_rate: 0.8 }, 'generic_charter').multiYear[0]
    expect(filled.enrollment).toBe(96)
    expect(filled.revenue.regularEd).toBe(Math.round(96 * (1_320_000 / 120)))
    expect(filled.revenue.regularEd).toBeLessThan(base.revenue.regularEd)
    const cut = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], { ...BASE_LEVERS(p), per_pupil_funding_adjustment: -0.05 }, 'generic_charter').multiYear[0]
    expect(cut.revenue.regularEd).toBe(Math.round(120 * (1_320_000 * 0.95 / 120)))
  })

  test('generic per-pupil without a saved line: the default rate is adjusted', () => {
    const p = profile({ custom_revenue_lines: [] })
    const base = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], BASE_LEVERS(p), 'generic_charter').multiYear[0]
    expect(base.revenue.regularEd).toBe(120 * 10000)
    const cut = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], { ...BASE_LEVERS(p), enrollment_fill_rate: 0.9, per_pupil_funding_adjustment: -0.1 }, 'generic_charter').multiYear[0]
    expect(cut.revenue.regularEd).toBe(Math.round(108 * 10000 * 0.9))
  })

  test('tuition pathways: the funding lever adjusts tuition; facility and personnel levers apply', () => {
    const p = profile()
    const out = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], { ...BASE_LEVERS(p), per_pupil_funding_adjustment: 0.05, facility_cost_monthly: 10000, personnel_cost_adjustment: 0.1 }, 'generic_private').multiYear[0]
    expect(out.revenue.regularEd).toBe(Math.round(120 * Math.round(14000 * 1.05) * (1 - 0.1)))
    expect(out.operations.facilities).toBe(120000)
    const base = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], BASE_LEVERS(p), 'generic_private').multiYear[0]
    expect(out.personnel.totalSalaries).toBe(POSITIONS.reduce((s, x) => s + x.fte * Math.round(x.annual_salary * 1.1), 0))
    expect(out.personnel.totalSalaries).toBeGreaterThan(base.personnel.totalSalaries)
  })

  test('status keys: four FPF measures on WA, three health benchmarks elsewhere', () => {
    expect(scenarioStatusKeys('wa_charter')).toHaveLength(4)
    expect(scenarioStatusKeys(undefined)).toHaveLength(4)
    expect(scenarioStatusKeys('generic_micro')).toEqual(['fpf_current_ratio', 'fpf_days_cash', 'fpf_total_margin'])
  })

  test('meets count: Approaching is not a pass (P2-FU-05)', () => {
    const year = { fpf_current_ratio: 'meets', fpf_days_cash: 'approaches', fpf_total_margin: 'does_not_meet', fpf_enrollment_variance: 'meets' }
    expect(scenarioMeetsCount(year, 'wa_charter')).toEqual({ meets: 2, total: 4 })
    expect(scenarioMeetsCount({ ...year, fpf_days_cash: 'approaching' }, 'wa_charter').meets).toBe(2)
    // Generic pathways grade three measures; the enrollment entry is ignored.
    expect(scenarioMeetsCount(year, 'generic_micro')).toEqual({ meets: 1, total: 3 })
    expect(scenarioMeetsCount(undefined, 'wa_charter')).toEqual({ meets: 0, total: 4 })
  })
})

// --- (b) Admin portfolio -------------------------------------------------------------------

test.describe('admin portfolio health by pathway', () => {
  test('WA: Stage 1 issues and the matrix come from the FPF scorecard', () => {
    const p = profile()
    const rows = runProjections(inputs('wa_charter', p))
    const fpf = computeFPFScorecard(rows, 250000, false)
    const h = portfolioHealthFor('wa_charter', rows, 250000, p)
    expect(h.healthPathway).toBe('wa_charter')
    expect(h.issues).toEqual(fpfIssuesForStage(fpf, 1))
    expect(h.matrix.DC).toEqual(fpf.measures.find((m) => m.name === 'Days of Cash')!.statuses.map(fromFpfStatus))
    expect(h.matrix.EV).toEqual(fpf.measures.find((m) => m.name === 'Enrollment Variance')!.statuses.map(fromFpfStatus))
  })

  test('generic: issues and the matrix come from the generic health scorecard', () => {
    // No cash and a deficit: the reserve-days measure is in the concern band in Year 1.
    const p = profile({ startup_funding: [], custom_revenue_lines: [{ key: 'per_pupil_funding', label: 'Per-Pupil Funding', amount: 600_000 }] })
    const rows = runProjections(inputs('generic_charter', p, 0))
    const g = genericScorecardFor(rows, 0, getStateConfig('generic_charter'), p)!
    const h = portfolioHealthFor('generic_charter', rows, 0, p)
    expect(h.healthPathway).toBe('generic')
    expect(h.issues).toEqual(genericIssuesForYears(g, 2))
    expect(h.issues).toContain('Reserve Days (Cash on Hand)')
    expect(h.matrix.DC).toEqual(g.measures.find((m) => m.name === 'Reserve Days (Cash on Hand)')!.values.map((v) => fromGenericColor(v.status)))
    expect(h.matrix.EV).toEqual(['na', 'na', 'na', 'na', 'na'])
  })

  test('genericIssuesForYears counts red measures in Years 1..N only', () => {
    const sc = { measures: [
      { name: 'A', values: [{ year: 1, status: 'green' }, { year: 3, status: 'red' }] },
      { name: 'B', values: [{ year: 2, status: 'red' }] },
      { name: 'C', applicable: false, values: [{ year: 1, status: 'red' }] },
    ] }
    expect(genericIssuesForYears(sc)).toEqual(['B'])
    expect(genericIssuesForYears(sc, 3)).toEqual(['A', 'B'])
  })

  function school(pathway: string): PortfolioSchoolMetrics {
    return {
      name: 'S', status: 'Active', pathway, gradeConfig: 'K-5', openingYear: 2027, enrollmentY1: 120, reserveDays: 45,
      personnelPct: 70, netPosition: 1, totalRevenue: 1, totalExpenses: 1, fpfIssues: 0, readinessScore: 4,
      advisoryStatus: 'x', onboardingComplete: true, multiYear: [], scenarios: null,
    }
  }

  test('portfolio PDF labels: FPF for WA-only, health benchmarks for generic-only, both when mixed', () => {
    const wa = buildPortfolioPdfHtml({ orgName: 'O', dateStr: 'd', schools: [school('wa_charter')] })
    expect(wa).toContain('Meeting FPF Stage 1</div>')
    expect(wa).toContain('<th>FPF</th>')
    const generic = buildPortfolioPdfHtml({ orgName: 'O', dateStr: 'd', schools: [school('generic')] })
    expect(generic).toContain('Meeting Health Benchmarks</div>')
    expect(generic).toContain('<th>Health</th>')
    expect(generic).not.toContain('FPF')
    const mixed = buildPortfolioPdfHtml({ orgName: 'O', dateStr: 'd', schools: [school('wa_charter'), school('generic')] })
    expect(mixed).toContain('<th>FPF / Health</th>')
  })
})

// --- Narrative PDF: fiscal span and scenario health count ---------------------------------------

test.describe('narrative PDF on a generic charter', () => {
  function payload(pathway: 'wa_charter' | 'generic_charter', fiscalStart: number | null): NarrativePayload {
    const p = profile({ fiscal_year_start_month: fiscalStart })
    const multiYear = runProjections(inputs(pathway, p))
    const scenario = computeScenarioProjections(p, POSITIONS, POSITIONS, PROJECTIONS, [], BASE_LEVERS(p), pathway)
    return {
      schoolName: 'S', pathway,
      profile: p as unknown as NarrativePayload['profile'],
      assumptions: DEFAULT_ASSUMPTIONS as unknown as NarrativePayload['assumptions'],
      positions: POSITIONS as unknown as NarrativePayload['positions'],
      projections: PROJECTIONS,
      multiYear,
      scorecard: (pathway === 'wa_charter'
        ? computeFPFScorecard(multiYear, 250000, false)
        : genericScorecardFor(multiYear, 250000, getStateConfig(pathway), p)!) as NarrativePayload['scorecard'],
      scenarios: [{ name: 'Base Case', assumptions: BASE_LEVERS(p) as unknown as Record<string, number>, results: scenario.results as never, ai_analysis: null }] as unknown as NarrativePayload['scenarios'],
    } as NarrativePayload
  }

  test('generic charter: July–June year and x/3 health count', async () => {
    const html = await buildNarrativeHtml(payload('generic_charter', 7), async () => '')
    expect(html).toContain('Year 1 (July through June)')
    expect(html).toMatch(/\d\/3 meet/)
  })

  test('WA: September–August and x/4 FPF count, whatever the profile month', async () => {
    const html = await buildNarrativeHtml(payload('wa_charter', 7), async () => '')
    expect(html).toContain('Year 1 (September through August)')
    expect(html).toMatch(/\d\/4 meet/)
  })
})
