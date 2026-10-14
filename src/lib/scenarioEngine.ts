import type { SchoolProfile, StaffingPosition, BudgetProjection, GradeExpansionEntry, FinancialAssumptions } from './types'
import { getAssumptions } from './types'
import {
  computeMultiYearDetailed,
  computeFPFScorecard,
  computeCarryForward,
  runProjections,
  genericScorecardFor,
  scalePerStudentRevenueLines,
  GENERIC_DEFAULT_PER_PUPIL_RATE,
  beginningCashOf,
  personnelPctOfRevenue,
  breakEvenEnrollment,
  facilityCostOf,
  type MultiYearDetailedRow,
  type FPFScorecard,
  type GenericHealthScorecard,
} from './budgetEngine'
import { evaluateEnrollmentVariance, fromGenericColor, toFpfStatus, type FpfStatus } from './healthThresholds'
import { getStateConfig, type StateConfig } from './stateConfig'

export interface ScenarioAssumptions {
  enrollment_fill_rate: number    // 0.70 to 1.00
  per_pupil_funding_adjustment: number  // -0.10 to +0.05
  personnel_cost_adjustment: number     // -0.10 to +0.15
  facility_cost_monthly: number         // $0 to $50,000
  startup_capital: number               // $0 to $1,000,000
}

export interface ScenarioYearResult {
  enrollment: number
  total_revenue: number
  total_personnel: number
  total_operations: number
  total_expenses: number
  net_position: number
  beginning_cash: number
  ending_cash: number
  reserve_days: number
  personnel_pct: number
  total_margin: number
  current_ratio: number
  break_even_enrollment: number
  fpf_current_ratio: string
  fpf_days_cash: string
  fpf_enrollment_variance: string
  fpf_total_margin: string
  // Variance vs. charter-contract enrollment: enrollment_fill_rate − 1. Used by the UI to
  // render the FPF Enrollment Variance cell (e.g. -20% for 80% fill, 0% for 100%, +5% for 105%).
  enrollment_variance_pct: number
  // Expense breakdown
  facility_cost: number
  // Revenue breakdown
  regular_ed_revenue: number
  sped_revenue: number
  facilities_revenue: number
  small_school_enhancement: number
  federal_categorical: number
  startup_grants: number
  other_revenue: number
}

/**
 * Derive an FPF Enrollment Variance status from the scenario's fill rate.
 * The Commission compares actual enrollment to charter-contract enrollment; the scenario
 * models a fractional fill rate vs that target. The band (and its stage) comes from the
 * shared Enrollment Variance band in healthThresholds.ts (R-HEALTH-01), the same one the
 * FPF scorecard applies.
 */
export function enrollmentVarianceStatus(fillRate: number, year: number = 1): FpfStatus {
  // Integer-percent scale, rounded to 0.1 to drop float noise (0.95 * 100 → 95).
  const pctOfProjected = Math.round(fillRate * 1000) / 10
  return toFpfStatus(evaluateEnrollmentVariance(pctOfProjected, year).status)
}

export interface ScenarioResults {
  years: Record<string, ScenarioYearResult>
}

/** The fpf_* status fields a scenario year stores. */
export type ScenarioStatusKey = 'fpf_current_ratio' | 'fpf_days_cash' | 'fpf_total_margin' | 'fpf_enrollment_variance'

/**
 * The status fields that grade a scenario on the school's pathway. WA: the four Commission FPF
 * measures. Other pathways store the generic health benchmarks in the same fields (Current
 * Ratio, Days of Cash, Total Margin) and have no Enrollment Variance measure ('na').
 */
export function scenarioStatusKeys(pathway?: string | null): ScenarioStatusKey[] {
  return !pathway || pathway === 'wa_charter'
    ? ['fpf_current_ratio', 'fpf_days_cash', 'fpf_total_margin', 'fpf_enrollment_variance']
    : ['fpf_current_ratio', 'fpf_days_cash', 'fpf_total_margin']
}

export interface ScenarioProjection {
  results: ScenarioResults
  multiYear: MultiYearDetailedRow[]
  /** Commission FPF scorecard on multiYear (every pathway, as in ScenarioContext). */
  scorecard: FPFScorecard
  /** Generic health scorecard for non-WA pathways (the one the results are graded on); null on WA. */
  genericScorecard: GenericHealthScorecard | null
}

/**
 * Apply the five levers to the school's base data and run the pathway's engine
 * (computeMultiYearDetailed on WA, computeGenericProjections otherwise). `pathway` omitted
 * means WA.
 */
export function computeScenarioProjections(
  profile: SchoolProfile,
  positions: StaffingPosition[],
  allPositions: StaffingPosition[],
  projections: BudgetProjection[],
  gradeExpansionPlan: GradeExpansionEntry[],
  levers: ScenarioAssumptions,
  pathway?: string | null,
): ScenarioProjection {
  const config = getStateConfig(pathway)
  if (config.pathway !== 'wa_charter') {
    return computeGenericScenario(profile, positions, allPositions, projections, gradeExpansionPlan, levers, config)
  }
  const assumptions = getAssumptions(profile.financial_assumptions)

  // Apply lever 1: Enrollment Fill Rate — scale all enrollment targets
  const adjustedProfile: SchoolProfile = {
    ...profile,
    target_enrollment_y1: Math.round(profile.target_enrollment_y1 * levers.enrollment_fill_rate),
    target_enrollment_y2: Math.round(profile.target_enrollment_y2 * levers.enrollment_fill_rate),
    target_enrollment_y3: Math.round(profile.target_enrollment_y3 * levers.enrollment_fill_rate),
    target_enrollment_y4: Math.round(profile.target_enrollment_y4 * levers.enrollment_fill_rate),
    target_enrollment_y5: Math.round((profile.target_enrollment_y5 || profile.target_enrollment_y4) * levers.enrollment_fill_rate),
  }

  // Apply lever 1 to grade expansion plan
  const adjustedExpansion: GradeExpansionEntry[] = gradeExpansionPlan.map(e => ({
    ...e,
    students_per_section: Math.round(e.students_per_section * levers.enrollment_fill_rate),
  }))

  // Apply lever 2: Per-Pupil Funding Adjustment — adjust state revenue rates
  const adjustedAssumptions: FinancialAssumptions = {
    ...assumptions,
    regular_ed_per_pupil: Math.round(assumptions.regular_ed_per_pupil * (1 + levers.per_pupil_funding_adjustment)),
    sped_per_pupil: Math.round(assumptions.sped_per_pupil * (1 + levers.per_pupil_funding_adjustment)),
    facilities_per_pupil: Math.round(assumptions.facilities_per_pupil * (1 + levers.per_pupil_funding_adjustment)),
  }

  // Apply lever 4: Facility Cost — override the Y1 facility projection (engine consumes Y1
  // and scales forward via the ops escalator; Y2+ rows are currently unused but kept intact).
  const adjustedProjections: BudgetProjection[] = projections.map(p => {
    if (p.subcategory === 'Facilities' && !p.is_revenue && p.year === 1) {
      return { ...p, amount: levers.facility_cost_monthly * 12 }
    }
    return p
  })

  // Apply lever 3: Personnel Cost Adjustment — adjust all position salaries
  const adjustPersonnel = (pos: StaffingPosition[]): StaffingPosition[] =>
    pos.map(p => ({
      ...p,
      annual_salary: Math.round(p.annual_salary * (1 + levers.personnel_cost_adjustment)),
    }))

  const adjustedPositions = adjustPersonnel(positions)
  const adjustedAllPositions = adjustPersonnel(allPositions)

  // Apply lever 5: Startup Capital — override carry-forward
  // The startup capital replaces the computed carry-forward
  const preOpenCash = levers.startup_capital

  // Compute multi-year projections using the existing engine
  const adjustedProfileWithAssumptions: SchoolProfile = {
    ...adjustedProfile,
    financial_assumptions: adjustedAssumptions,
  }

  const multiYear = computeMultiYearDetailed(
    adjustedProfileWithAssumptions,
    adjustedPositions,
    adjustedProjections,
    adjustedAssumptions,
    preOpenCash,
    adjustedExpansion.length > 0 ? adjustedExpansion : undefined,
    adjustedAllPositions,
    profile.startup_funding,
  )

  const scorecard = computeFPFScorecard(multiYear, preOpenCash, false)

  // Build results object
  const years: Record<string, ScenarioYearResult> = {}
  for (let i = 0; i < multiYear.length; i++) {
    const r = multiYear[i]
    const y = String(i + 1)
    const currentRatio = scorecard.measures.find(m => m.name === 'Current Ratio')?.values[i] ?? 0
    const totalMargin = scorecard.measures.find(m => m.name === 'Total Margin')?.values[i] ?? 0

    // FPF status from scorecard
    const fpfCurrentRatio = scorecard.measures.find(m => m.name === 'Current Ratio')?.statuses[i] || 'na'
    const fpfDaysCash = scorecard.measures.find(m => m.name === 'Days of Cash')?.statuses[i] || 'na'
    const fpfTotalMargin = scorecard.measures.find(m => m.name === 'Total Margin')?.statuses[i] || 'na'

    const federalCategorical = r.revenue.titleI + r.revenue.idea + r.revenue.lap +
      r.revenue.lapHighPoverty + r.revenue.tbip + r.revenue.hicap
    const otherRevenue = r.revenue.foodServiceRev + r.revenue.transportationRev + r.revenue.interestIncome

    years[y] = {
      enrollment: r.enrollment,
      total_revenue: r.revenue.total,
      total_personnel: r.personnel.total,
      total_operations: r.operations.total,
      total_expenses: r.totalExpenses,
      net_position: r.net,
      // Cash and ratios come from the engine row via the shared helpers, so the Scenarios tab,
      // Overview card, PDF and Excel agree with Multi-Year and the FPF scorecard.
      beginning_cash: beginningCashOf(r),
      ending_cash: r.endingCash,
      reserve_days: r.reserveDays,
      personnel_pct: Math.round(personnelPctOfRevenue(r) * 10) / 10,
      total_margin: totalMargin as number,
      current_ratio: currentRatio as number,
      break_even_enrollment: breakEvenEnrollment(r),
      fpf_current_ratio: fpfCurrentRatio,
      fpf_days_cash: fpfDaysCash,
      fpf_enrollment_variance: enrollmentVarianceStatus(levers.enrollment_fill_rate, i + 1),
      fpf_total_margin: fpfTotalMargin,
      enrollment_variance_pct: levers.enrollment_fill_rate - 1,
      facility_cost: facilityCostOf(r),
      regular_ed_revenue: r.revenue.regularEd,
      sped_revenue: r.revenue.sped + r.revenue.stateSped,
      facilities_revenue: r.revenue.facilitiesRev,
      small_school_enhancement: r.revenue.smallSchoolEnhancement,
      federal_categorical: federalCategorical,
      startup_grants: r.revenue.grantRevenue,
      other_revenue: otherRevenue,
    }
  }

  return { results: { years }, multiYear, scorecard, genericScorecard: null }
}

/** Enrollment fill-rate lever: every enrollment target and grade-plan section scaled. */
function scaleEnrollment(profile: SchoolProfile, gradeExpansionPlan: GradeExpansionEntry[], fillRate: number) {
  return {
    profile: {
      ...profile,
      target_enrollment_y1: Math.round(profile.target_enrollment_y1 * fillRate),
      target_enrollment_y2: Math.round(profile.target_enrollment_y2 * fillRate),
      target_enrollment_y3: Math.round(profile.target_enrollment_y3 * fillRate),
      target_enrollment_y4: Math.round(profile.target_enrollment_y4 * fillRate),
      target_enrollment_y5: Math.round((profile.target_enrollment_y5 || profile.target_enrollment_y4) * fillRate),
    } as SchoolProfile,
    gradeExpansionPlan: gradeExpansionPlan.map(e => ({ ...e, students_per_section: Math.round(e.students_per_section * fillRate) })),
  }
}

/**
 * Generic pathways: the same five levers on the generic engine's inputs.
 * - Fill rate scales enrollment and holds per-student revenue (the per-pupil funding and
 *   registration-fee lines are Year-1 totals the engine divides by Year-1 enrollment, so they
 *   are scaled by the enrollment ratio, as in computeEnrollmentSensitivity).
 * - Per-pupil funding adjusts the per-pupil funding line (per-pupil pathways) or the tuition
 *   rate (tuition pathways).
 * - Personnel, facility and startup-capital levers as on WA.
 * Results are graded on the generic health scorecard, stored in the same fpf_* fields.
 */
function computeGenericScenario(
  profile: SchoolProfile,
  positions: StaffingPosition[],
  allPositions: StaffingPosition[],
  projections: BudgetProjection[],
  gradeExpansionPlan: GradeExpansionEntry[],
  levers: ScenarioAssumptions,
  config: StateConfig,
): ScenarioProjection {
  const assumptions = getAssumptions(profile.financial_assumptions)
  const preOpenCash = levers.startup_capital
  // The generic engine reads Year-1 operations (the dashboard passes Year-1 rows only).
  const y1Projections = projections
    .filter(p => p.year === 1)
    .map(p => (p.subcategory === 'Facilities' && !p.is_revenue ? { ...p, amount: levers.facility_cost_monthly * 12 } : p))
  const adjustPersonnel = (pos: StaffingPosition[]): StaffingPosition[] =>
    pos.map(p => ({ ...p, annual_salary: Math.round(p.annual_salary * (1 + levers.personnel_cost_adjustment)) }))
  const run = (p: SchoolProfile, gep: GradeExpansionEntry[]) => runProjections({
    pathway: config.pathway,
    config,
    profile: p,
    positions: adjustPersonnel(positions),
    projections: y1Projections,
    assumptions,
    preOpenCash,
    gradeExpansionPlan: gep.length > 0 ? gep : undefined,
    allPositions: adjustPersonnel(allPositions),
    startupFunding: profile.startup_funding,
  })

  const scaled = scaleEnrollment(profile, gradeExpansionPlan, levers.enrollment_fill_rate)
  const baseEnrollment = run(profile, gradeExpansionPlan)[0]?.enrollment ?? 0
  const reducedEnrollment = run(scaled.profile, scaled.gradeExpansionPlan)[0]?.enrollment ?? 0
  const ratio = baseEnrollment > 0 ? reducedEnrollment / baseEnrollment : levers.enrollment_fill_rate
  const raw = profile as unknown as Record<string, unknown>
  const fundingMult = 1 + levers.per_pupil_funding_adjustment
  const lines = (Array.isArray(raw.custom_revenue_lines)
    ? scalePerStudentRevenueLines(raw.custom_revenue_lines, ratio)
    : []) as { key?: string; amount?: number }[]
  const adjusted: Record<string, unknown> = { ...scaled.profile }
  if (config.revenue_model === 'tuition') {
    const tuition = (raw.tuition_rate as number) || config.tuition_rate_default || 0
    adjusted.tuition_rate = Math.round(tuition * fundingMult)
    adjusted.custom_revenue_lines = lines
  } else {
    const hasLine = lines.some(l => l?.key === 'per_pupil_funding')
    adjusted.custom_revenue_lines = hasLine
      ? lines.map(l => (l?.key === 'per_pupil_funding' && typeof l.amount === 'number' ? { ...l, amount: l.amount * fundingMult } : l))
      : fundingMult === 1
        ? lines
        // No saved line: the engine's default rate, held per student and adjusted.
        : [...lines, { key: 'per_pupil_funding', label: 'Per-Pupil Funding', amount: GENERIC_DEFAULT_PER_PUPIL_RATE * reducedEnrollment * fundingMult }]
  }
  const adjustedProfile = adjusted as unknown as SchoolProfile

  const multiYear = run(adjustedProfile, scaled.gradeExpansionPlan)
  const scorecard = computeFPFScorecard(multiYear, preOpenCash, false)
  const genericScorecard = genericScorecardFor(multiYear, preOpenCash, config, adjustedProfile)
  const measure = (name: string) => genericScorecard?.measures.find(m => m.name === name)
  const cr = measure('Current Ratio')
  const days = measure('Reserve Days (Cash on Hand)')
  const margin = measure('Total Margin (Net / Revenue)')
  const status = (m: typeof cr, i: number): FpfStatus => toFpfStatus(fromGenericColor(m?.values[i]?.status))

  const years: Record<string, ScenarioYearResult> = {}
  multiYear.forEach((r, i) => {
    years[String(i + 1)] = {
      enrollment: r.enrollment,
      total_revenue: r.revenue.total,
      total_personnel: r.personnel.total,
      total_operations: r.operations.total,
      total_expenses: r.totalExpenses,
      net_position: r.net,
      beginning_cash: beginningCashOf(r),
      ending_cash: r.endingCash,
      reserve_days: r.reserveDays,
      personnel_pct: Math.round(personnelPctOfRevenue(r) * 10) / 10,
      total_margin: margin?.values[i]?.value ?? 0,
      current_ratio: cr?.values[i]?.value ?? 0,
      break_even_enrollment: breakEvenEnrollment(r),
      fpf_current_ratio: status(cr, i),
      fpf_days_cash: status(days, i),
      fpf_enrollment_variance: 'na',
      fpf_total_margin: status(margin, i),
      enrollment_variance_pct: levers.enrollment_fill_rate - 1,
      facility_cost: facilityCostOf(r),
      regular_ed_revenue: r.revenue.regularEd,
      sped_revenue: 0,
      facilities_revenue: 0,
      small_school_enhancement: 0,
      federal_categorical: 0,
      startup_grants: r.revenue.grantRevenue,
      // Fees, fundraising and interest: everything besides the primary line and grants.
      other_revenue: r.revenue.total - r.revenue.regularEd - r.revenue.grantRevenue,
    }
  })

  return { results: { years }, multiYear, scorecard, genericScorecard }
}

export function getDefaultScenarioAssumptions(
  profile: SchoolProfile,
): { conservative: ScenarioAssumptions; base: ScenarioAssumptions; optimistic: ScenarioAssumptions } {
  const carryForward = computeCarryForward(profile)
  const facilityAmount = 15000 // Will be overridden by actual data in seed route

  return {
    conservative: {
      enrollment_fill_rate: 0.80,
      per_pupil_funding_adjustment: -0.05,
      personnel_cost_adjustment: 0.05,
      facility_cost_monthly: Math.round(facilityAmount * 1.10),
      startup_capital: Math.round(carryForward * 0.75),
    },
    base: {
      enrollment_fill_rate: 0.90,
      per_pupil_funding_adjustment: 0.0,
      personnel_cost_adjustment: 0.0,
      facility_cost_monthly: facilityAmount,
      startup_capital: carryForward,
    },
    optimistic: {
      enrollment_fill_rate: 0.95,
      per_pupil_funding_adjustment: 0.0,
      personnel_cost_adjustment: -0.03,
      facility_cost_monthly: Math.round(facilityAmount * 0.95),
      startup_capital: Math.round(carryForward * 1.25),
    },
  }
}
