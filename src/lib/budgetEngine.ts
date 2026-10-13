import { readCustomLines, customLineYearAmount } from './customLines'
import { readFacilityFinancing, annualDepreciation, annualInterest } from './facilityFinancing'
import { canonicalizeStartupFunding } from './startupFunding'
import { canonicalizePreOpeningTransactions, canonicalizePreOpeningExpenses } from './preOpening'
import {
  calcBenefits,
  calcCommissionRevenue,
  calcAuthorizerFeeCommission,
  calcSmallSchoolEnhancement,
  type CommissionRevenue,
} from './calculations'
import type { SchoolProfile, StaffingPosition, BudgetProjection, FinancialAssumptions, GradeExpansionEntry, StartupFundingSource } from './types'
import {
  classify,
  toFpfStatus,
  toGenericColor,
  fpfIssuesForStage,
  getCurrentRatioBand,
  getDaysOfCashBand,
  getTotalMarginBand,
  getThreeYearMarginBand,
  getDebtToAssetBand,
  getCashFlowBand,
  getEnrollmentVarianceBand,
  getGenericPersonnelBand,
  getBreakEvenPctBand,
  getFinancialAidPctBand,
  type FpfStatus,
  type HealthBand,
} from './healthThresholds'

/**
 * Canonical state apportionment base for WA charter schools.
 *
 * Used for: (1) authorizer fee calculation (3% of this value), (2) dashboard state
 * apportionment totals (row.revenue.apportionment). It is NOT the monthly cash-timing
 * base: computeMonthlyCashFlow's OSPI bucket also includes levy equity, matching the
 * Commission Excel.
 *
 * VERIFICATION FLAG (2026-04-17): SSE inclusion is a working assumption
 * pending confirmation against the Portfolio Schools LLC charter contract.
 * If the contract defines the fee base without SSE, change this helper
 * (removing `smallSchoolEnhancement`) and all downstream uses update.
 *
 * Excludes: levy equity, federal funds, categoricals, food service,
 * transportation, interest income, startup grants.
 */
export function stateApportionmentBase(
  rev: CommissionRevenue,
  smallSchoolEnhancement: number = 0,
): number {
  return rev.regularEd + rev.sped + rev.stateSped + rev.facilitiesRev + smallSchoolEnhancement
}

// --- Grant Revenue Utility ---

/** Get grant revenue for a specific year (1-5) from startup funding sources */
export function getGrantRevenueForYear(
  sources: StartupFundingSource[] | null | undefined,
  year: number,
): number {
  // P-UX-18: canonicalize raw startup_funding at the reader boundary (drops null/garbage
  // entries, coerces amount) before iterating. No-op on canonical input.
  const clean = canonicalizeStartupFunding(sources)
  if (clean.length === 0) return 0
  let total = 0
  for (const src of clean) {
    // If explicit year allocations exist for this source, use them (even if 0)
    if (src.yearAllocations && year in src.yearAllocations) {
      total += src.yearAllocations[year] || 0
    } else if (src.selectedYears?.includes(year)) {
      // Evenly divide across selected years only if NO explicit allocations exist at all
      if (!src.yearAllocations || Object.keys(src.yearAllocations).length === 0) {
        const yearCount = src.selectedYears.length
        total += Math.round(src.amount / yearCount)
      }
      // Otherwise, explicit allocations exist but not for this year — $0
    }
  }
  return total
}

/** Get per-source grant allocations for a specific year */
export function getGrantAllocationsForYear(
  sources: StartupFundingSource[] | null | undefined,
  year: number,
): { source: string; amount: number; type: StartupFundingSource['type'] }[] {
  // P-UX-18: canonicalize at the reader boundary. No-op on canonical input.
  const clean = canonicalizeStartupFunding(sources)
  if (clean.length === 0) return []
  return clean.map((src) => {
    let amount = 0
    if (src.yearAllocations && year in src.yearAllocations) {
      amount = src.yearAllocations[year] || 0
    } else if (src.selectedYears?.includes(year)) {
      if (!src.yearAllocations || Object.keys(src.yearAllocations).length === 0) {
        const yearCount = src.selectedYears.length
        amount = Math.round(src.amount / yearCount)
      }
    }
    return { source: src.source, amount, type: src.type }
  }).filter((a) => a.amount > 0)
}
import { expansionToEnrollmentArray, computeExpansionEnrollments, teachersPerNewGrade, getRetentionRate } from './gradeExpansion'

// --- Year 0 Carry-Forward ---

/** Year-0 carry-forward sub-components. P-UX-20: single source for the multiyear page's
 *  component displays (year0Total + preOpenExpenses), so no surface re-derives them inline. */
export interface CarryForwardBreakdown {
  year0Total: number
  preOpenActualSpend: number
  preOpenBudget: number
  preOpenExpenses: number
  carryForward: number
}

/** Carry-forward from Year 0 into Year 1, with its sub-components (Multi-Year tab logic).
 *  Year 0 total = sum of Y0 allocations (or full amount for sources with no year selection).
 *  Pre-opening spend = actual transactions if any, else budgeted amounts.
 *  Carry-forward = year0Total - preOpeningSpend.
 */
export function computeCarryForwardBreakdown(profile: SchoolProfile): CarryForwardBreakdown {
  // P-UX-18: canonicalize raw startup_funding (the actual first crash site) before iterating.
  // No-op on canonical input. P-UX-19 does the same for the pre_opening_* reads below.
  const sources: StartupFundingSource[] = canonicalizeStartupFunding(profile.startup_funding)
  const totalFunding = sources.reduce((s, f) => s + f.amount, 0)

  let year0Total = 0
  for (const src of sources) {
    if (src.selectedYears?.includes(0) && src.yearAllocations?.[0]) {
      year0Total += src.yearAllocations[0]
    } else if (!src.selectedYears || src.selectedYears.length === 0) {
      year0Total += src.amount
    }
  }
  if (year0Total === 0) year0Total = totalFunding

  // P-UX-19: canonicalize at the reader boundary (drops null/non-object/non-finite entries;
  // no-op on canonical input). Closes the sibling null-entry crash flagged by P-UX-18.
  const preOpenActualSpend = canonicalizePreOpeningTransactions(profile.pre_opening_transactions).reduce((s, tx) => s + tx.amount, 0)
  const preOpenBudget = canonicalizePreOpeningExpenses(profile.pre_opening_expenses).reduce((s, e) => s + e.budgeted, 0)
  const preOpenExpenses = preOpenActualSpend > 0 ? preOpenActualSpend : preOpenBudget

  return { year0Total, preOpenActualSpend, preOpenBudget, preOpenExpenses, carryForward: year0Total - preOpenExpenses }
}

/** Carry-forward scalar — delegates to computeCarryForwardBreakdown (single source). */
export function computeCarryForward(profile: SchoolProfile): number {
  return computeCarryForwardBreakdown(profile).carryForward
}

// --- Multi-Year Personnel Scaling ---

export interface MultiYearStaffing {
  teachers: number
  paras: number
  officeStaff: number
  otherStaff: number
  totalPositions: number
  totalPersonnelCost: number
  totalSalaries: number
  totalBenefits: number
}

export function computeMultiYearPersonnel(
  enrollment: number,
  year: number,
  basePositions: StaffingPosition[],
  y1Enrollment: number,
  salaryEscalator: number,
  benefitsRate: number = 0.30,
): MultiYearStaffing {
  const escalator = Math.pow(salaryEscalator, year - 1)

  const teacherPositions = basePositions.filter(
    (p) => p.category === 'certificated' && /teacher/i.test(p.title)
  )
  const paraPositions = basePositions.filter((p) => /para/i.test(p.title))
  const officePositions = basePositions.filter((p) => /office/i.test(p.title))

  const y1TeacherFte = teacherPositions.reduce((s, p) => s + p.fte, 0)
  const y1ParaFte = paraPositions.reduce((s, p) => s + p.fte, 0)
  const y1OfficeFte = officePositions.reduce((s, p) => s + p.fte, 0)

  const studentsPerTeacher = y1TeacherFte > 0 ? y1Enrollment / y1TeacherFte : 24
  const requiredTeachers = Math.ceil(enrollment / studentsPerTeacher)
  const additionalTeachers = Math.max(0, requiredTeachers - y1TeacherFte)

  const additionalParas = (enrollment >= 150 && y1ParaFte < 3) ? Math.min(1, 3 - y1ParaFte) : 0
  const additionalOffice = (enrollment >= 200 && y1OfficeFte < 2) ? Math.min(1, 2 - y1OfficeFte) : 0

  let totalSalaries = 0
  let totalBenefits = 0
  for (const pos of basePositions) {
    const salary = Math.round(pos.annual_salary * escalator)
    const cost = pos.fte * salary
    totalSalaries += cost
    totalBenefits += calcBenefits(cost, benefitsRate)
  }

  const leadTeacherSalary = teacherPositions[0]?.annual_salary || 58000
  if (additionalTeachers > 0) {
    const newSalary = Math.round(leadTeacherSalary * escalator)
    const cost = additionalTeachers * newSalary
    totalSalaries += cost
    totalBenefits += calcBenefits(cost, benefitsRate)
  }

  if (additionalParas > 0) {
    const paraSalary = paraPositions[0]?.annual_salary || 35000
    const cost = additionalParas * Math.round(paraSalary * escalator)
    totalSalaries += cost
    totalBenefits += calcBenefits(cost, benefitsRate)
  }

  if (additionalOffice > 0) {
    const officeSalary = officePositions[0]?.annual_salary || 42000
    const cost = additionalOffice * Math.round(officeSalary * escalator)
    totalSalaries += cost
    totalBenefits += calcBenefits(cost, benefitsRate)
  }

  const baseTotalFte = basePositions.reduce((s, p) => s + p.fte, 0)
  const otherFte = baseTotalFte - y1TeacherFte - y1ParaFte - y1OfficeFte
  const totalTeachers = y1TeacherFte + additionalTeachers
  const totalParas = y1ParaFte + additionalParas
  const totalOffice = y1OfficeFte + additionalOffice

  return {
    teachers: totalTeachers,
    paras: totalParas,
    officeStaff: totalOffice,
    otherStaff: otherFte,
    totalPositions: totalTeachers + totalParas + totalOffice + otherFte,
    totalPersonnelCost: totalSalaries + totalBenefits,
    totalSalaries,
    totalBenefits,
  }
}

// --- Multi-Year Detailed Breakdown ---

export interface MultiYearDetailedRow {
  year: number
  enrollment: number
  aafte: number
  revenue: {
    regularEd: number
    sped: number
    stateSped: number
    facilitiesRev: number
    levyEquity: number
    titleI: number
    idea: number
    lap: number
    lapHighPoverty: number
    tbip: number
    hicap: number
    foodServiceRev: number
    transportationRev: number
    smallSchoolEnhancement: number
    interestIncome: number
    grantRevenue: number
    operatingRevenue: number
    total: number
    // Legacy aliases
    apportionment: number
    // R-REV-03: per-line custom revenue breakdown (engine emits; Commission export reads).
    // recurring: true -> operatingRevenue; false -> one-time (non-operating, lands in Sep cash).
    customRevenue?: { id: string; name: string; group: string; amount: number; recurring: boolean }[]
  }
  personnel: {
    certificated: number
    classified: number
    admin: number
    benefits: number
    total: number
    totalSalaries: number
  }
  operations: {
    facilities: number
    supplies: number
    contracted: number
    technology: number
    authorizerFee: number
    insurance: number
    foodService: number
    transportation: number
    curriculum: number
    profDev: number
    marketing: number
    fundraising: number
    contingency: number
    total: number
    // R-REV-07: per-line custom expense breakdown (engine emits; Commission export reads)
    customExpense?: { id: string; name: string; group: string; amount: number }[]
    // P-FIN-01/02: facility depreciation + debt interest, emitted ONLY when the school
    // has facility_financing (absent for lease schools, keeping output byte-identical).
    depreciation?: number
    interest?: number
  }
  totalExpenses: number
  net: number
  /** Accrual net position: pre-opening carry-forward + Σ net through this year. */
  cumulativeNet: number
  /**
   * Year-end CASH: cumulativeNet plus cumulative non-cash depreciation (P-FIN-01). Equals the
   * FPF scorecard's cash for the year when the scorecard starts from the same carry-forward.
   * Equals cumulativeNet for lease schools and every generic-pathway school.
   */
  endingCash: number
  reserveDays: number
  staffing: MultiYearStaffing
  expansionDetail?: {
    returning: number
    newGrade: number
    grades: string[]
    newGrades: string[]
  }
}

export function computeMultiYearDetailed(
  profile: SchoolProfile,
  positions: StaffingPosition[],
  projections: BudgetProjection[],
  assumptions: FinancialAssumptions,
  preOpeningNet: number,
  gradeExpansionPlan?: GradeExpansionEntry[],
  allPositions?: StaffingPosition[],
  startupFunding?: StartupFundingSource[] | null,
): MultiYearDetailedRow[] {
  // Use grade expansion enrollments if available, else fall back to flat profile targets
  const hasExpansion = gradeExpansionPlan && gradeExpansionPlan.length > 0
  const retentionRate = getRetentionRate(profile)
  const expansionEnrollments = hasExpansion
    ? expansionToEnrollmentArray(gradeExpansionPlan!, retentionRate)
    : null
  const expansionDetails = hasExpansion
    ? computeExpansionEnrollments(gradeExpansionPlan!, retentionRate)
    : null

  const enrollments = expansionEnrollments || [
    profile.target_enrollment_y1,
    profile.target_enrollment_y2,
    profile.target_enrollment_y3,
    profile.target_enrollment_y4,
    profile.target_enrollment_y5 || profile.target_enrollment_y4,
  ]
  const salaryEscalator = 1 + assumptions.salary_escalator_pct / 100
  const opsEscalator = 1 + assumptions.ops_escalator_pct / 100
  const benefitsRate = assumptions.benefits_load_pct / 100
  const feeRate = assumptions.authorizer_fee_pct / 100

  // Year 1 base data from projections — ALL operational categories.
  // Explicitly filter `p.year === 1`: callers may pass a multi-year list, but this engine
  // currently scales Y1 forward with the ops escalator rather than consuming per-year opex rows.
  const y1Ops = (sub: string) =>
    projections.find((p) => !p.is_revenue && p.year === 1 && p.subcategory === sub)?.amount || 0
  const y1Facilities = y1Ops('Facilities')
  const y1Supplies = y1Ops('Supplies & Materials')
  const y1Contracted = y1Ops('Contracted Services')
  const y1Technology = y1Ops('Technology')
  const y1Insurance = y1Ops('Insurance')
  const y1FoodService = y1Ops('Food Service')
  const y1Transportation = y1Ops('Transportation')
  const y1Curriculum = y1Ops('Curriculum & Materials')
  const y1ProfDev = y1Ops('Professional Development')
  const y1Marketing = y1Ops('Marketing & Outreach')
  const y1Fundraising = y1Ops('Fundraising')

  let cumulativeNet = preOpeningNet
  const rows: MultiYearDetailedRow[] = []

  // R-REV-03/07: custom revenue + expense lines (WA pathway). Tolerates the legacy
  // generic flat shape; the Generic engine (computeGenericProjections) is untouched.
  const customRevenueLines = readCustomLines((profile as unknown as Record<string, unknown>).custom_revenue_lines)
  const customExpenseLines = readCustomLines((profile as unknown as Record<string, unknown>).custom_expense_lines)
  const fteY1 = positions.reduce((s, p) => s + (p.fte || 0), 0)

  // P-FIN-01/02: facility depreciation + debt interest (WA pathway; null for lease schools
  // and for Generic/Private/Micro, which never populate facility_financing).
  const facilityFinancing = readFacilityFinancing((profile as unknown as Record<string, unknown>).facility_financing)
  let cumulativeDepreciation = 0

  const interestRate = assumptions.interest_rate_on_cash / 100

  for (let y = 1; y <= 5; y++) {
    const enr = enrollments[y - 1] || enrollments[enrollments.length - 1] || enrollments[0]

    // Small School Enhancement — uses grade expansion plan for grade-band enrollment.
    // Computed before calcCommissionRevenue so it folds into rev.total as a true total.
    const smallSchoolEnhancement = hasExpansion
      ? calcSmallSchoolEnhancement(gradeExpansionPlan!, y, assumptions.aafte_pct, assumptions.regular_ed_per_pupil, assumptions.regionalization_factor || 1.0, y, assumptions.revenue_cola_pct)
      : 0
    // Revenue — Commission-aligned with COLA. SSE passed in so rev.total is complete.
    const rev = calcCommissionRevenue(enr, profile.pct_frl, profile.pct_iep, profile.pct_ell, profile.pct_hicap, assumptions, y, smallSchoolEnhancement)
    // Interest income on prior year ending CASH balance. P-FIN-01: cumulativeNet is an
    // accrual net-position figure; depreciation (non-cash) must be added back to recover
    // actual cash. cumulativeDepreciation here holds prior years' total (this year's is
    // added after net, below), so this is the prior year's cash. 0 for lease schools, so
    // priorCash == cumulativeNet and the result is byte-identical.
    const priorCash = cumulativeNet + cumulativeDepreciation
    const interestIncome = y === 1
      ? Math.round(Math.max(0, priorCash) * interestRate / 2) // half-year approximation
      : Math.round(Math.max(0, priorCash) * interestRate)
    // Grant revenue for this year from startup funding allocations
    const yearGrantRevenue = getGrantRevenueForYear(startupFunding, y)
    // F-006 fix: operatingRevenue means "earned from school operations" — rev.total only.
    // rev.total already includes SSE + foodServiceRev + transportationRev + all 13 revenue lines.
    // Interest income and grant revenue are NON-operating sources reported separately.
    // totalRevenue is the sum of everything; downstream ratios that need the operating-only
    // denominator (Personnel %, Facility %, FPF Total Margin) read operatingRevenue.
    // Downstream ratios that need everything-in (e.g., Year 1 trajectory headline) read total.
    let operatingRevenue = rev.total
    let totalRevenue = operatingRevenue + interestIncome + yearGrantRevenue
    // State apportionment (canonical — see stateApportionmentBase). Used for the authorizer fee.
    const stateApport = stateApportionmentBase(rev, smallSchoolEnhancement)

    // Personnel — use year-specific positions if available, else auto-scale
    const yearPositions = allPositions?.filter((p) => p.year === y)
    const hasYearPositions = yearPositions && yearPositions.length > 0
    const positionsForYear = hasYearPositions ? yearPositions : positions

    const staffing = y === 1
      ? computeYear1Staffing(positions, benefitsRate)
      : hasYearPositions
        ? computeYear1Staffing(yearPositions, benefitsRate)
        : computeMultiYearPersonnel(enr, y, positions, enrollments[0], salaryEscalator, benefitsRate)

    let certCost = 0, classCost = 0, adminCost = 0, benefitsCost = 0, totalSalaries = 0
    if (hasYearPositions || y === 1) {
      // Use actual position data for this year
      const escalator = y === 1 ? 1 : Math.pow(salaryEscalator, y - 1)
      for (const pos of positionsForYear) {
        const salary = Math.round(pos.annual_salary * escalator)
        const cost = pos.fte * salary
        const ben = calcBenefits(cost, benefitsRate)
        if (pos.category === 'certificated') certCost += cost
        else if (pos.category === 'classified') classCost += cost
        else if (pos.category === 'admin') adminCost += cost
        benefitsCost += ben
      }
      totalSalaries = certCost + classCost + adminCost
    } else {
      // Scaled positions (legacy: no year-specific data)
      const escalator = Math.pow(salaryEscalator, y - 1)
      const teacherPositions = positions.filter(p => p.category === 'certificated' && /teacher/i.test(p.title))
      const additionalTeachers = staffing.teachers - teacherPositions.reduce((s, p) => s + p.fte, 0)

      for (const pos of positions) {
        const salary = Math.round(pos.annual_salary * escalator)
        const cost = pos.fte * salary
        if (pos.category === 'certificated') certCost += cost
        else if (pos.category === 'classified') classCost += cost
        else if (pos.category === 'admin') adminCost += cost
        benefitsCost += calcBenefits(cost, benefitsRate)
      }
      // Additional teachers — use grade expansion data if available
      let effectiveAdditionalTeachers = additionalTeachers
      if (hasExpansion && expansionDetails) {
        const yearDetail = expansionDetails.find((d) => d.year === y)
        if (yearDetail && yearDetail.newGrades.length > 0) {
          const gradeBasedTeachers = yearDetail.newGrades.reduce((sum, grade) => {
            const gradeEntry = gradeExpansionPlan!.find((e) => e.year === y && e.grade_level === grade)
            return sum + teachersPerNewGrade(grade, gradeEntry?.sections || 2)
          }, 0)
          effectiveAdditionalTeachers = Math.max(additionalTeachers, gradeBasedTeachers)
        }
      }
      if (effectiveAdditionalTeachers > 0) {
        const leadSalary = teacherPositions[0]?.annual_salary || 58000
        const cost = effectiveAdditionalTeachers * Math.round(leadSalary * escalator)
        certCost += cost
        benefitsCost += calcBenefits(cost, benefitsRate)
      }
      // Additional paras
      const paraPositions = positions.filter(p => /para/i.test(p.title))
      const y1ParaFte = paraPositions.reduce((s, p) => s + p.fte, 0)
      const additionalParas = (enr >= 150 && y1ParaFte < 3) ? Math.min(1, 3 - y1ParaFte) : 0
      if (additionalParas > 0) {
        const cost = additionalParas * Math.round((paraPositions[0]?.annual_salary || 35000) * escalator)
        classCost += cost
        benefitsCost += calcBenefits(cost, benefitsRate)
      }
      // Additional office
      const officePositions = positions.filter(p => /office/i.test(p.title))
      const y1OfficeFte = officePositions.reduce((s, p) => s + p.fte, 0)
      const additionalOffice = (enr >= 200 && y1OfficeFte < 2) ? Math.min(1, 2 - y1OfficeFte) : 0
      if (additionalOffice > 0) {
        const cost = additionalOffice * Math.round((officePositions[0]?.annual_salary || 42000) * escalator)
        classCost += cost
        benefitsCost += calcBenefits(cost, benefitsRate)
      }
      totalSalaries = certCost + classCost + adminCost
    }
    const totalPersonnel = certCost + classCost + adminCost + benefitsCost

    // R-REV-03/07: custom REVENUE fold. Done BEFORE the expense block so operatingRevenue
    // (the recurring operating-revenue base) is finalized for any pct_revenue expense line.
    // Recurring -> operatingRevenue (Total Margin denominator); one-time -> non-operating only.
    const fteForYear = positionsForYear.reduce((s, p) => s + (p.fte || 0), 0)
    const revColaMult = Math.pow(1 + assumptions.revenue_cola_pct / 100, y - 1)
    const customRevenueDetail = customRevenueLines.map((line) => ({
      id: line.id,
      name: line.name,
      group: line.group,
      recurring: line.recurring,
      amount: customLineYearAmount(line, y, {
        enrollment: enr,
        enrollmentY1: enrollments[0] || 0,
        fte: fteForYear,
        fteY1,
        escalatorMult: revColaMult,
      }),
    }))
    let customRecurringTotal = 0
    let customOneTimeTotal = 0
    customRevenueLines.forEach((line, i) => {
      if (line.recurring) customRecurringTotal += customRevenueDetail[i].amount
      else customOneTimeTotal += customRevenueDetail[i].amount
    })
    operatingRevenue += customRecurringTotal
    totalRevenue += customRecurringTotal + customOneTimeTotal

    // Operations — all categories scaled appropriately
    const opsScale = Math.pow(opsEscalator, y - 1)
    const enrRatio = enrollments[0] > 0 ? enr / enrollments[0] : 1
    const facilities = Math.round(y1Facilities * opsScale)
    const supplies = Math.round(y1Supplies * enrRatio * opsScale)
    const contracted = Math.round(y1Contracted * enrRatio * opsScale)
    const technology = Math.round(y1Technology * enrRatio * opsScale)
    const authorizerFee = calcAuthorizerFeeCommission(stateApport, feeRate)
    const insurance = Math.round(y1Insurance * opsScale)
    const foodService = Math.round(y1FoodService * enrRatio * opsScale)
    const transportation = Math.round(y1Transportation * enrRatio * opsScale)
    const curriculum = Math.round(y1Curriculum * enrRatio * opsScale)
    const profDev = Math.round(y1ProfDev * opsScale) // scales with inflation, not enrollment
    const marketing = Math.round(y1Marketing * opsScale) // scales with inflation only
    const fundraising = Math.round(y1Fundraising * opsScale)
    const contingencyBase = totalPersonnel + facilities + supplies + contracted + technology + authorizerFee + insurance + foodService + transportation + curriculum + profDev + marketing + fundraising
    const contingency = Math.round(contingencyBase * (assumptions.contingency_pct / 100))
    let totalOperations = facilities + supplies + contracted + technology + authorizerFee + insurance + foodService + transportation + curriculum + profDev + marketing + fundraising + contingency

    // R-REV-07: custom EXPENSE fold. Ratio drivers escalate with opsEscalator (opsScale);
    // pct_revenue lines read the finalized recurring operating-revenue base (operatingRevenue,
    // already folded above) in the authorizerFee slot. Added AFTER contingency so the
    // contingency base is byte-identical when there are no custom expense lines.
    const customExpenseDetail = customExpenseLines.map((line) => ({
      id: line.id,
      name: line.name,
      group: line.group,
      amount: customLineYearAmount(line, y, {
        enrollment: enr,
        enrollmentY1: enrollments[0] || 0,
        fte: fteForYear,
        fteY1,
        escalatorMult: opsScale,
        recurringRevenueBase: operatingRevenue,
      }),
    }))
    const customExpenseTotal = customExpenseDetail.reduce((s, d) => s + d.amount, 0)
    totalOperations += customExpenseTotal

    // P-FIN-01/02: fold facility depreciation + interest AFTER contingency + custom expense
    // (so the contingency base stays byte-identical when there is no financing). Both are
    // 0 for lease schools. depreciation is straight-line; interest is the V11 monthly
    // fully-amortizing schedule.
    const depreciation = facilityFinancing ? annualDepreciation(facilityFinancing, y) : 0
    const facilityInterest = facilityFinancing ? annualInterest(facilityFinancing, y) : 0
    totalOperations += depreciation + facilityInterest

    const totalExpenses = totalPersonnel + totalOperations

    const net = totalRevenue - totalExpenses
    cumulativeNet += net
    // Days of Cash — shares computeDaysOfCash with the FPF Scorecard. depreciation is
    // non-cash: subtracted from the denominator AND added back to the cash numerator
    // (cumulative), so it is DCOH-neutral; interest (cash) lowers it. Reduces to the prior
    // formula when there is no financing (depreciation 0, add-back 0).
    cumulativeDepreciation += depreciation
    const reserveDays = computeDaysOfCash(cumulativeNet + cumulativeDepreciation, totalExpenses, depreciation)

    const expansionDetail = expansionDetails
      ? expansionDetails.find((d) => d.year === y)
      : undefined

    rows.push({
      year: y,
      enrollment: enr,
      aafte: rev.aafte,
      revenue: {
        regularEd: rev.regularEd,
        sped: rev.sped,
        stateSped: rev.stateSped,
        facilitiesRev: rev.facilitiesRev,
        levyEquity: rev.levyEquity,
        titleI: rev.titleI,
        idea: rev.idea,
        lap: rev.lap,
        lapHighPoverty: rev.lapHighPoverty,
        tbip: rev.tbip,
        hicap: rev.hicap,
        foodServiceRev: rev.foodServiceRev,
        transportationRev: rev.transportationRev,
        smallSchoolEnhancement,
        interestIncome,
        grantRevenue: yearGrantRevenue,
        operatingRevenue,
        total: totalRevenue,
        apportionment: stateApportionmentBase(rev, smallSchoolEnhancement),
        customRevenue: customRevenueDetail,
      },
      personnel: {
        certificated: certCost,
        classified: classCost,
        admin: adminCost,
        benefits: benefitsCost,
        total: totalPersonnel,
        totalSalaries,
      },
      operations: { facilities, supplies, contracted, technology, authorizerFee, insurance, foodService, transportation, curriculum, profDev, marketing, fundraising, contingency, total: totalOperations, customExpense: customExpenseDetail, ...(facilityFinancing ? { depreciation, interest: facilityInterest } : {}) },
      totalExpenses,
      net,
      cumulativeNet,
      endingCash: cumulativeNet + cumulativeDepreciation,
      reserveDays,
      staffing,
      expansionDetail: expansionDetail ? {
        returning: expansionDetail.returning,
        newGrade: expansionDetail.newGrade,
        grades: expansionDetail.grades,
        newGrades: expansionDetail.newGrades,
      } : undefined,
    })
  }

  return rows
}

function computeYear1Staffing(positions: StaffingPosition[], benefitsRate: number = 0.30): MultiYearStaffing {
  const teacherPositions = positions.filter(p => p.category === 'certificated' && /teacher/i.test(p.title))
  const paraPositions = positions.filter(p => /para/i.test(p.title))
  const officePositions = positions.filter(p => /office/i.test(p.title))
  let totalSalaries = 0
  let totalBenefits = 0
  for (const p of positions) {
    const cost = p.fte * p.annual_salary
    totalSalaries += cost
    totalBenefits += calcBenefits(cost, benefitsRate)
  }
  const teacherFte = teacherPositions.reduce((s, p) => s + p.fte, 0)
  const paraFte = paraPositions.reduce((s, p) => s + p.fte, 0)
  const officeFte = officePositions.reduce((s, p) => s + p.fte, 0)
  const totalFte = positions.reduce((s, p) => s + p.fte, 0)
  return {
    teachers: teacherFte,
    paras: paraFte,
    officeStaff: officeFte,
    otherStaff: totalFte - teacherFte - paraFte - officeFte,
    totalPositions: totalFte,
    totalPersonnelCost: totalSalaries + totalBenefits,
    totalSalaries,
    totalBenefits,
  }
}

/** Fiscal-year month labels (WA charter: September–August). */
export const MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']

export interface CashFlowMonth {
  month: string
  /** Share of the scheduled revenue paid this month (WA: OSPI apportionment schedule). */
  apportionmentPct: number
  /** Scheduled revenue this month (WA: state apportionment incl. levy equity). */
  apportionmentAmt: number
  otherRevenue: number
  totalInflow: number
  payroll: number
  otherExpenses: number
  netCashFlow: number
  beginningBalance: number
  cumulativeBalance: number
}

// --- Monthly cash flow (one model for the Cash Flow tab, narrative PDF, Commission Excel
// and the admin portfolio view) ---

/**
 * The row fields computeMonthlyCashFlow reads: a structural subset of MultiYearDetailedRow,
 * so the export routes can pass the JSON rows the client sends.
 */
export interface MonthlyCashFlowRow {
  revenue: {
    regularEd: number; sped: number; stateSped: number; facilitiesRev: number
    smallSchoolEnhancement: number; levyEquity: number
    titleI: number; idea: number
    lap: number; lapHighPoverty: number; tbip: number; hicap: number
    foodServiceRev: number; transportationRev: number
    interestIncome: number; grantRevenue: number
    total: number
    customRevenue?: { group: string; amount: number; recurring?: boolean }[]
  }
  personnel: { total: number }
  operations: { depreciation?: number }
  totalExpenses: number
}

export interface MonthlyCashFlow {
  months: CashFlowMonth[]
  startingCash: number
  endingCash: number
  totals: { inflow: number; payroll: number; otherExpenses: number; outflow: number; depreciationExcluded: number }
  /** true on the WA pathway (OSPI apportionment timing); false uses the pathway's payment schedule. */
  usesOspiSchedule: boolean
  /** Months with a markedly small scheduled share (WA: Nov and May; tuition: Jul and Aug). */
  lowScheduleMonths: string[]
}

/** Split an annual amount into 12 whole-dollar months; August absorbs the rounding remainder. */
function splitMonthly(annual: number): number[] {
  const m = Math.round(annual / 12)
  return MONTHS.map((_, i) => (i < 11 ? m : annual - 11 * m))
}

/**
 * Twelve-month (Sep–Aug) cash flow for one projection year.
 *
 * Revenue timing (WA charter), the same arithmetic as the Commission Excel so its monthly
 * Revenue row is unchanged for schools without custom lines:
 * - State apportionment (regular ed, SPED, state SPED, facilities, SSE, levy equity, and
 *   recurring custom 'State & Local' lines): OSPI schedule
 * - Federal (Title I, IDEA, recurring custom 'Federal'): tenths, Oct–Jul
 * - Food service + transportation revenue (and recurring custom 'Program Revenue'): tenths, Sep–Jun
 * - State categoricals and every other recurring custom line: twelfths
 * - Interest income: twelfths
 * - Startup grants and one-time custom lines: September
 * Other pathways spread operating revenue (less interest and one-time items) over the
 * pathway's payment_schedule, with interest and one-time items timed as above.
 *
 * Cash outflows are totalExpenses minus non-cash depreciation, split evenly with August
 * absorbing the rounding; facility interest stays in (cash cost). So the August balance
 * equals the FPF scorecard's year-end cash (row.endingCash when startingCash is the year's
 * beginning cash) within a few dollars of per-month inflow rounding.
 */
export function computeMonthlyCashFlow(
  row: MonthlyCashFlowRow,
  startingCash: number,
  opts: { pathway?: string | null } = {},
): MonthlyCashFlow {
  const config = getStateConfig(opts.pathway)
  const isWa = config.pathway === 'wa_charter'
  const schedule = config.payment_schedule
  const r = row.revenue

  const custom = r.customRevenue ?? []
  const isOneTime = (c: { recurring?: boolean }) => c.recurring === false
  const customSum = (pred: (c: { group: string; recurring?: boolean }) => boolean) =>
    custom.reduce((s, c) => s + (pred(c) ? c.amount || 0 : 0), 0)
  const TIMED_GROUPS = ['State & Local', 'Federal', 'Program Revenue']
  const recurringIn = (group: string) => customSum((c) => !isOneTime(c) && c.group === group)
  const oneTime = customSum(isOneTime)

  const ospi = r.regularEd + r.sped + r.stateSped + r.facilitiesRev + r.smallSchoolEnhancement + r.levyEquity + recurringIn('State & Local')
  const federal = r.titleI + r.idea + recurringIn('Federal')
  const flat = r.lap + r.lapHighPoverty + r.tbip + r.hicap + customSum((c) => !isOneTime(c) && !TIMED_GROUPS.includes(c.group))
  const program = r.foodServiceRev + r.transportationRev + recurringIn('Program Revenue')
  const interest = r.interestIncome
  const lump = r.grantRevenue + oneTime
  const scheduledBase = isWa ? ospi : r.total - r.grantRevenue - r.interestIncome - oneTime

  const depreciation = row.operations.depreciation ?? 0
  const outflows = splitMonthly(row.totalExpenses - depreciation)
  const payrolls = splitMonthly(row.personnel.total)

  let balance = startingCash
  const months: CashFlowMonth[] = MONTHS.map((month, i) => {
    const pct = schedule[i] ?? 0
    let amount = scheduledBase * pct / 100
    if (isWa) {
      if (i >= 1 && i <= 10) amount += federal / 10
      amount += flat / 12
      if (i <= 9) amount += program / 10
    }
    amount += interest / 12
    if (i === 0) amount += lump
    const totalInflow = Math.round(amount)
    const apportionmentAmt = Math.round(scheduledBase * pct / 100)
    const netCashFlow = totalInflow - outflows[i]
    const beginningBalance = balance
    balance += netCashFlow
    return {
      month,
      apportionmentPct: pct / 100,
      apportionmentAmt,
      otherRevenue: totalInflow - apportionmentAmt,
      totalInflow,
      payroll: payrolls[i],
      otherExpenses: outflows[i] - payrolls[i],
      netCashFlow,
      beginningBalance,
      cumulativeBalance: balance,
    }
  })

  const minPct = Math.min(...schedule)
  const lowScheduleMonths = minPct < (100 / 12) * 0.75
    ? MONTHS.filter((_, i) => (schedule[i] ?? 0) === minPct)
    : []
  const sum = (k: 'totalInflow' | 'payroll' | 'otherExpenses') => months.reduce((s, m) => s + m[k], 0)
  return {
    months,
    startingCash,
    endingCash: balance,
    totals: {
      inflow: sum('totalInflow'),
      payroll: sum('payroll'),
      otherExpenses: sum('otherExpenses'),
      outflow: row.totalExpenses - depreciation,
      depreciationExcluded: depreciation,
    },
    usesOspiSchedule: isWa,
    lowScheduleMonths,
  }
}

// --- Row-derived metrics (one definition for every surface) ---

/** Cash at the start of the row's year (Year 1: the pre-opening carry-forward). */
export function beginningCashOf(row: { endingCash: number; net: number; operations: { depreciation?: number } }): number {
  return row.endingCash - row.net - (row.operations.depreciation ?? 0)
}

/** Personnel cost as a % of operating revenue (integer-percent scale, unrounded; 0 with no revenue). */
export function personnelPctOfRevenue(row: { personnel: { total: number }; revenue: { operatingRevenue: number } }): number {
  return row.revenue.operatingRevenue > 0 ? (row.personnel.total / row.revenue.operatingRevenue) * 100 : 0
}

/** Facility cost: the facilities (lease/occupancy) line plus, when financed, depreciation and interest. */
export function facilityCostOf(row: { operations: { facilities: number; depreciation?: number; interest?: number } }): number {
  return row.operations.facilities + (row.operations.depreciation ?? 0) + (row.operations.interest ?? 0)
}

/** Facility cost as a % of operating revenue (integer-percent scale, unrounded; 0 with no revenue). */
export function facilityPctOfRevenue(row: { operations: { facilities: number; depreciation?: number; interest?: number }; revenue: { operatingRevenue: number } }): number {
  return row.revenue.operatingRevenue > 0 ? (facilityCostOf(row) / row.revenue.operatingRevenue) * 100 : 0
}

/** Students needed to cover the year's total expenses at its operating revenue per student. */
export function breakEvenEnrollment(row: { enrollment: number; totalExpenses: number; revenue: { operatingRevenue: number } }): number {
  const perPupil = row.enrollment > 0 ? row.revenue.operatingRevenue / row.enrollment : 0
  return perPupil > 0 ? Math.ceil(row.totalExpenses / perPupil) : 0
}

/**
 * Total margin % as the pathway's scorecard defines it. WA: net ÷ operating revenue, one
 * decimal (FPF Total Margin). Generic: net ÷ total revenue, unrounded (health scorecard).
 */
export function totalMarginPct(row: { net: number; revenue: { operatingRevenue: number; total: number } }, pathway?: string | null): number {
  if (pathway && pathway !== 'wa_charter') {
    return row.revenue.total > 0 ? (row.net / row.revenue.total) * 100 : 0
  }
  return row.revenue.operatingRevenue > 0 ? Math.round((row.net / row.revenue.operatingRevenue) * 1000) / 10 : 0
}

// --- Commission Financial Performance Framework (FPF) Scorecard ---

export interface FPFMeasure {
  name: string
  formula: string
  values: (number | null)[] // one per year (5)
  stage1Target: string
  stage2Target: string
  stage1Approaching?: string
  stage2Approaching?: string
  statuses: ('meets' | 'approaches' | 'does_not_meet' | 'na')[]
  note?: string // measure-specific annotation for the scorecard display
}

export interface FPFScorecard {
  measures: FPFMeasure[]
  overallStatus: 'green' | 'yellow' | 'red'
  overallMessage: string
}

/** R-HEALTH-01: classify against the shared band (healthThresholds.ts) in FPF vocabulary. */
function fpfStatus(value: number | null, band: HealthBand): FpfStatus {
  return value === null ? 'na' : toFpfStatus(classify(value, band))
}

/**
 * Shared Days-of-Cash (DCOH) calculation — single source of truth for both the FPF
 * Scorecard and the engine's per-year reserveDays so they can't drift (P-FIN-01/02).
 *
 * Denominator excludes depreciation (non-cash, per V11 / OSPI:
 * `Unrestricted Cash / ((Expenses - Depreciation) / 365)`); interest stays in (cash cost).
 * The caller supplies `endingCash` already adjusted for the depreciation add-back, so
 * depreciation is DCOH-neutral (subtracted from the denominator AND added back to cash)
 * while interest lowers DCOH. With no financing, depreciation = 0 and the add-back = 0,
 * so this reduces exactly to the prior formula (byte-identical for lease schools).
 */
export function computeDaysOfCash(endingCash: number, totalExpenses: number, depreciation: number): number {
  const dailyExpense = (totalExpenses - depreciation) / 365
  return dailyExpense > 0 ? Math.round(endingCash / dailyExpense) : 0
}

export function computeFPFScorecard(
  multiYear: MultiYearDetailedRow[],
  startingCash: number,
  conservativeMode: boolean,
): FPFScorecard {
  // Build year-end CASH balances. P-FIN-01: depreciation is non-cash, so it is added back
  // (cumulatively) to recover actual cash. This single cashOnHand figure backs EVERY
  // cash-derived measure below (Current Ratio, Days of Cash, Cash Flow, Multi-Year Cash
  // Flow) so they can't disagree. Zero add-back for lease schools => byte-identical.
  const cashOnHand: number[] = []
  let cash = startingCash
  for (const row of multiYear) {
    cash += row.net + (row.operations.depreciation ?? 0)
    cashOnHand.push(cash)
  }

  const measures: FPFMeasure[] = []

  // 1. Current Ratio — FPF: Current Assets / Current Liabilities (balance sheet)
  // Planning proxy: Cash / (monthly CASH expenses) — months of expenses covered. P-FIN-01:
  // depreciation is non-cash, so it is excluded from the monthly-expense denominator AND
  // already added back to cashOnHand (numerator); the ratio is therefore depreciation-
  // neutral while interest (cash) still lowers it. Reduces to Expenses/12 for lease schools.
  const currentRatioValues = multiYear.map((row, i) => {
    const monthlyExpenses = (row.totalExpenses - (row.operations.depreciation ?? 0)) / 12
    return monthlyExpenses > 0 ? cashOnHand[i] / monthlyExpenses : 99
  })
  measures.push({
    name: 'Current Ratio',
    formula: 'Current Assets ÷ Current Liabilities',
    values: currentRatioValues.map(v => Math.round(v * 100) / 100),
    stage1Target: getCurrentRatioBand(1).target,
    stage2Target: getCurrentRatioBand(3).target,
    stage1Approaching: getCurrentRatioBand(1).approachingRange,
    stage2Approaching: getCurrentRatioBand(3).approachingRange,
    statuses: currentRatioValues.map((v, i) => fpfStatus(v, getCurrentRatioBand(i + 1))),
    note: 'Planning proxy: Ending Cash ÷ (Annual Expenses / 12). The Commission calculates this from audited balance sheet data.',
  })

  // 2. Unrestricted Days Cash — FPF: Unrestricted Cash / [(Total Expenses - Depreciation) / 365]
  // P-FIN-01: cashOnHand already carries the depreciation add-back; the denominator excludes
  // depreciation. So it is DCOH-neutral; interest stays in (cash cost). Shares
  // computeDaysOfCash with the engine's reserveDays. Zero add-back for lease schools.
  const daysOfCash = multiYear.map((row, i) =>
    computeDaysOfCash(cashOnHand[i], row.totalExpenses, row.operations.depreciation ?? 0)
  )
  measures.push({
    name: 'Days of Cash',
    formula: 'Unrestricted Cash ÷ ((Expenses − Depreciation) / 365)',
    values: daysOfCash,
    stage1Target: getDaysOfCashBand(1).target,
    stage2Target: getDaysOfCashBand(3).target,
    stage1Approaching: getDaysOfCashBand(1).approachingRange,
    stage2Approaching: getDaysOfCashBand(3).approachingRange,
    statuses: daysOfCash.map((v, i) => fpfStatus(v, getDaysOfCashBand(i + 1))),
  })

  // 3. Total Margin — FPF: Net Income / Operating Revenue (excludes one-time startup grants)
  const totalMargin = multiYear.map(row => totalMarginPct(row))
  measures.push({
    name: 'Total Margin',
    formula: 'Net Income ÷ Operating Revenue',
    values: totalMargin,
    stage1Target: getTotalMarginBand(1).target,
    stage2Target: getTotalMarginBand(3).target,
    stage1Approaching: getTotalMarginBand(1).approachingRange,
    stage2Approaching: getTotalMarginBand(3).approachingRange,
    statuses: totalMargin.map((v, i) => fpfStatus(v, getTotalMarginBand(i + 1))),
  })

  // 4. Aggregated 3-Year Total Margin — FPF: Total 3-Year Net Income / Total 3-Year Operating Revenue
  const threeYearMargin: (number | null)[] = multiYear.map((_, i) => {
    if (i < 2) return null // N/A for Years 1-2 (need 3 years of data)
    const netSum = multiYear.slice(i - 2, i + 1).reduce((s, r) => s + r.net, 0)
    const revSum = multiYear.slice(i - 2, i + 1).reduce((s, r) => s + r.revenue.operatingRevenue, 0)
    return revSum > 0 ? Math.round((netSum / revSum) * 1000) / 10 : 0
  })
  measures.push({
    name: '3-Year Total Margin',
    formula: '(Y(n-2)+Y(n-1)+Yn Net) ÷ (Y(n-2)+Y(n-1)+Yn Revenue)',
    values: threeYearMargin,
    stage1Target: 'N/A',
    stage2Target: getThreeYearMarginBand().target,
    stage2Approaching: getThreeYearMarginBand().approachingRange,
    statuses: threeYearMargin.map((v) => fpfStatus(v, getThreeYearMarginBand())),
  })

  // 5. Debt-to-Asset — FPF: Total Liabilities / Total Assets
  // No liabilities modeled in planning mode; ratio is 0.00
  measures.push({
    name: 'Debt-to-Asset',
    formula: 'Total Liabilities ÷ Total Assets',
    values: multiYear.map(() => 0),
    stage1Target: getDebtToAssetBand().target,
    stage2Target: getDebtToAssetBand().target,
    stage1Approaching: getDebtToAssetBand().approachingRange,
    stage2Approaching: getDebtToAssetBand().approachingRange,
    statuses: multiYear.map(() => fpfStatus(0, getDebtToAssetBand())),
    note: 'No liabilities modeled. The Commission calculates this from audited balance sheet data.',
  })

  // 6. Debt Default — FPF: Binary (in default or not)
  // Pre-opening school with no debt = N/A
  measures.push({
    name: 'Debt Default',
    formula: 'In default of loan covenants?',
    values: multiYear.map(() => null),
    stage1Target: 'No default',
    stage2Target: 'No default',
    statuses: multiYear.map(() => 'na'),
    note: 'N/A — No debt modeled in planning mode.',
  })

  // 7. Cash Flow (one-year) — FPF: Year N Total Cash − Year (N−1) Total Cash
  // Year 1 is N/A per FPF (no prior operating year)
  const cashFlowValues: (number | null)[] = multiYear.map((_, i) => {
    if (i === 0) return null // Year 1: no prior operating year
    return cashOnHand[i] - cashOnHand[i - 1]
  })
  measures.push({
    name: 'Cash Flow',
    formula: 'Year-End Cash − Prior Year-End Cash',
    values: cashFlowValues,
    stage1Target: getCashFlowBand(1).target,
    stage2Target: getCashFlowBand(3).target,
    statuses: cashFlowValues.map((v, i) => fpfStatus(v, getCashFlowBand(i + 1))),
  })

  // 8. Multi-Year Cash Flow — FPF: Year N Total Cash − Year (N−2) Total Cash (3-year span)
  // N/A for Years 1-2
  const threeYearCashFlow: (number | null)[] = multiYear.map((_, i) => {
    if (i < 2) return null // Need at least 3 years of data
    return cashOnHand[i] - cashOnHand[i - 2]
  })
  measures.push({
    name: 'Multi-Year Cash Flow',
    formula: 'Year N Cash − Year (N−2) Cash',
    values: threeYearCashFlow,
    stage1Target: 'N/A',
    stage2Target: getCashFlowBand(3).target,
    statuses: threeYearCashFlow.map((v, i) => fpfStatus(v, getCashFlowBand(i + 1))),
  })

  // 9. Enrollment Variance — FPF: Actual Enrollment / Projected Enrollment
  // In planning mode, actual = projected = 100%
  const enrollmentVariance = multiYear.map(() =>
    conservativeMode ? 90 : 100
  )
  measures.push({
    name: 'Enrollment Variance',
    formula: 'Actual Enrollment ÷ Projected Enrollment',
    values: enrollmentVariance,
    stage1Target: getEnrollmentVarianceBand(1).target,
    stage2Target: getEnrollmentVarianceBand(3).target,
    stage1Approaching: getEnrollmentVarianceBand(1).approachingRange,
    stage2Approaching: getEnrollmentVarianceBand(3).approachingRange,
    statuses: enrollmentVariance.map((v, i) => fpfStatus(v, getEnrollmentVarianceBand(i + 1))),
    note: 'Informational — becomes meaningful when operating with actual enrollment data.',
  })

  // Overall assessment — skips purely informational/N/A measures (FPF_OVERALL_SKIP)
  const stage1Issues = fpfIssuesForStage({ measures }, 1)
  const stage2Issues = fpfIssuesForStage({ measures }, 2)

  let overallStatus: 'green' | 'yellow' | 'red'
  let overallMessage: string

  if (stage1Issues.length === 0 && stage2Issues.length === 0) {
    overallStatus = 'green'
    overallMessage = 'Your model meets all Stage 1 standards for Years 1-2 and all Stage 2 standards for Years 3-5.'
  } else if (stage1Issues.length === 0) {
    overallStatus = 'yellow'
    overallMessage = `Your model meets Stage 1 standards but does not yet meet Stage 2 for: ${stage2Issues.join(', ')}.`
  } else {
    overallStatus = 'red'
    overallMessage = `Your model does not meet Stage 1 standards for: ${stage1Issues.join(', ')} — address before submitting.`
  }

  return { measures, overallStatus, overallMessage }
}

// --- Generic Pathway Projections ---

import { getStateConfig } from './stateConfig'
import type { StateConfig } from './stateConfig'

/**
 * Compute multi-year projections for generic (non-WA) pathways.
 * Returns the same MultiYearDetailedRow[] shape so all downstream consumers work.
 */
export function computeGenericProjections(
  profile: SchoolProfile,
  positions: StaffingPosition[],
  projections: BudgetProjection[],
  config: StateConfig,
  preOpeningNet: number,
  gradeExpansionPlan?: GradeExpansionEntry[],
  allPositions?: StaffingPosition[],
  startupFunding?: StartupFundingSource[] | null,
): MultiYearDetailedRow[] {
  const hasExpansion = gradeExpansionPlan && gradeExpansionPlan.length > 0
  const retentionRate = getRetentionRate(profile)
  const expansionEnrollments = hasExpansion
    ? expansionToEnrollmentArray(gradeExpansionPlan!, retentionRate)
    : null
  const expansionDetails = hasExpansion
    ? computeExpansionEnrollments(gradeExpansionPlan!, retentionRate)
    : null

  const enrollments = expansionEnrollments || [
    profile.target_enrollment_y1,
    profile.target_enrollment_y2,
    profile.target_enrollment_y3,
    profile.target_enrollment_y4,
    profile.target_enrollment_y5 || profile.target_enrollment_y4,
  ]

  const salaryEscalator = 1 + config.salary_escalator
  const revEscalator = 1 + config.revenue_escalator
  const opsEscalator = 1 + config.operations_escalator
  const benefitsRate = config.benefits_load
  const authorizerFeeRate = config.authorizer_fee
  const isTuition = config.revenue_model === 'tuition'

  // Read tuition/aid from profile (saved during onboarding Step 2)
  const tuitionRate = (profile as unknown as Record<string, unknown>).tuition_rate as number || config.tuition_rate_default || 0
  const financialAidPct = (profile as unknown as Record<string, unknown>).financial_aid_pct as number || config.financial_aid_pct_default || 0

  // Read per-pupil rate from custom revenue lines or assumptions
  const customLines = ((profile as unknown as Record<string, unknown>).custom_revenue_lines as { key: string; amount: number }[]) || []
  const perPupilLine = customLines.find(l => l.key === 'per_pupil_funding')
  const perPupilRate = perPupilLine ? perPupilLine.amount / (enrollments[0] || 1) : 10000
  const registrationFeeLine = customLines.find(l => l.key === 'registration_fees')
  const registrationFeePerStudent = registrationFeeLine ? registrationFeeLine.amount / (enrollments[0] || 1) : 0
  const fundraisingLine = customLines.find(l => l.key === 'fundraising')
  const baseFundraising = fundraisingLine?.amount || 0

  // Year 1 base operations from projections
  const y1Facilities = projections.find((p) => !p.is_revenue && p.subcategory === 'Facilities')?.amount || 0
  const y1Supplies = projections.find((p) => !p.is_revenue && p.subcategory === 'Supplies & Materials')?.amount || 0
  const y1Contracted = projections.find((p) => !p.is_revenue && p.subcategory === 'Contracted Services')?.amount || 0
  const y1Technology = projections.find((p) => !p.is_revenue && p.subcategory === 'Technology')?.amount || 0
  const y1Insurance = projections.find((p) => !p.is_revenue && p.subcategory === 'Insurance')?.amount || 0
  const y1FoodService = projections.find((p) => !p.is_revenue && p.subcategory === 'Food Service')?.amount || 0
  const y1Transportation = projections.find((p) => !p.is_revenue && p.subcategory === 'Transportation')?.amount || 0
  const y1Curriculum = projections.find((p) => !p.is_revenue && p.subcategory === 'Curriculum & Materials')?.amount || 0
  const y1ProfDev = projections.find((p) => !p.is_revenue && p.subcategory === 'Professional Development')?.amount || 0
  const y1Marketing = projections.find((p) => !p.is_revenue && p.subcategory === 'Marketing & Outreach')?.amount || 0
  const y1Fundraising = projections.find((p) => !p.is_revenue && p.subcategory === 'Fundraising')?.amount || 0
  const contingencyPct = (projections.find((p) => !p.is_revenue && p.subcategory === 'Contingency')?.amount || 0) > 0
    ? 0.02
    : (config.operations_defaults.contingency_pct ?? 2) / 100

  const interestRate = 0.03 // default for generic
  let cumulativeNet = preOpeningNet
  const rows: MultiYearDetailedRow[] = []

  for (let y = 1; y <= 5; y++) {
    const enr = enrollments[y - 1] || enrollments[enrollments.length - 1] || enrollments[0]
    const colaMult = Math.pow(revEscalator, y - 1)

    // --- Revenue ---
    let operatingRevenue: number
    let tuitionRevenue = 0
    let feeRevenue = 0
    let fundRevenue = 0

    if (isTuition) {
      // Tuition-based: enrollment × tuition × COLA × (1 - aid)
      tuitionRevenue = Math.round(enr * tuitionRate * colaMult * (1 - financialAidPct))
      feeRevenue = Math.round(enr * registrationFeePerStudent * colaMult)
      fundRevenue = Math.round(baseFundraising * colaMult)
      operatingRevenue = tuitionRevenue + feeRevenue + fundRevenue
    } else {
      // Per-pupil: enrollment × rate × COLA
      const ppRevenue = Math.round(enr * perPupilRate * colaMult)
      fundRevenue = Math.round(baseFundraising * colaMult)
      operatingRevenue = ppRevenue + fundRevenue
    }

    // Interest income
    const priorCash = cumulativeNet
    const interestIncome = y === 1
      ? Math.round(Math.max(0, priorCash) * interestRate / 2)
      : Math.round(Math.max(0, priorCash) * interestRate)
    operatingRevenue += interestIncome

    const yearGrantRevenue = getGrantRevenueForYear(startupFunding, y)
    const totalRevenue = operatingRevenue + yearGrantRevenue

    // --- Personnel ---
    const yearPositions = allPositions?.filter((p) => p.year === y)
    const hasYearPositions = yearPositions && yearPositions.length > 0
    const positionsForYear = hasYearPositions ? yearPositions : positions
    const escalator = y === 1 ? 1 : Math.pow(salaryEscalator, y - 1)

    let certCost = 0, classCost = 0, adminCost = 0, benefitsCost = 0, totalSalaries = 0
    for (const pos of positionsForYear) {
      const salary = Math.round(pos.annual_salary * escalator)
      const cost = pos.fte * salary
      const ben = Math.round(cost * benefitsRate)
      if (pos.category === 'certificated') certCost += cost
      else if (pos.category === 'classified') classCost += cost
      else if (pos.category === 'admin') adminCost += cost
      benefitsCost += ben
    }
    totalSalaries = certCost + classCost + adminCost
    const totalPersonnel = totalSalaries + benefitsCost

    const staffing = computeYear1Staffing(positionsForYear, benefitsRate)

    // --- Operations ---
    const opsScale = Math.pow(opsEscalator, y - 1)
    const enrRatio = enrollments[0] > 0 ? enr / enrollments[0] : 1
    const facilities = Math.round(y1Facilities * opsScale)
    const supplies = Math.round(y1Supplies * enrRatio * opsScale)
    const contracted = Math.round(y1Contracted * enrRatio * opsScale)
    const technology = Math.round(y1Technology * enrRatio * opsScale)
    const authorizerFee = Math.round(operatingRevenue * authorizerFeeRate)
    const insurance = Math.round(y1Insurance * opsScale)
    const foodService = Math.round(y1FoodService * enrRatio * opsScale)
    const transportation = Math.round(y1Transportation * enrRatio * opsScale)
    const curriculum = Math.round(y1Curriculum * enrRatio * opsScale)
    const profDev = Math.round(y1ProfDev * opsScale)
    const marketing = Math.round(y1Marketing * opsScale)
    const fundraisingExpense = Math.round(y1Fundraising * opsScale)
    const contingencyBase = totalPersonnel + facilities + supplies + contracted + technology + authorizerFee + insurance + foodService + transportation + curriculum + profDev + marketing + fundraisingExpense
    const contingency = Math.round(contingencyBase * contingencyPct)
    const totalOperations = facilities + supplies + contracted + technology + authorizerFee + insurance + foodService + transportation + curriculum + profDev + marketing + fundraisingExpense + contingency

    const totalExpenses = totalPersonnel + totalOperations
    const net = totalRevenue - totalExpenses
    cumulativeNet += net
    const dailyExpense = totalExpenses / 365
    const reserveDays = dailyExpense > 0 ? Math.round(cumulativeNet / dailyExpense) : 0

    const expansionDetail = expansionDetails?.find((d) => d.year === y)

    // Map revenue into the same shape — use regularEd for the primary revenue line, zeros for WA-specific
    rows.push({
      year: y,
      enrollment: enr,
      aafte: enr, // no AAFTE concept for generic
      revenue: {
        regularEd: isTuition ? tuitionRevenue : Math.round(enr * perPupilRate * colaMult),
        sped: 0,
        stateSped: 0,
        facilitiesRev: 0,
        levyEquity: 0,
        titleI: 0,
        idea: 0,
        lap: 0,
        lapHighPoverty: 0,
        tbip: 0,
        hicap: 0,
        foodServiceRev: 0,
        transportationRev: 0,
        smallSchoolEnhancement: 0,
        interestIncome,
        grantRevenue: yearGrantRevenue,
        operatingRevenue,
        total: totalRevenue,
        apportionment: isTuition ? tuitionRevenue : Math.round(enr * perPupilRate * colaMult),
      },
      personnel: {
        certificated: certCost,
        classified: classCost,
        admin: adminCost,
        benefits: benefitsCost,
        total: totalPersonnel,
        totalSalaries,
      },
      operations: { facilities, supplies, contracted, technology, authorizerFee, insurance, foodService, transportation, curriculum, profDev, marketing, fundraising: fundraisingExpense, contingency, total: totalOperations },
      totalExpenses,
      net,
      cumulativeNet,
      endingCash: cumulativeNet, // no depreciation on the generic pathway
      reserveDays,
      staffing,
      expansionDetail: expansionDetail ? {
        returning: expansionDetail.returning,
        newGrade: expansionDetail.newGrade,
        grades: expansionDetail.grades,
        newGrades: expansionDetail.newGrades,
      } : undefined,
    })
  }

  return rows
}

// --- One entry point for the pathway's engine, and the enrollment stress test ---

export interface ProjectionInputs {
  /** School pathway; anything other than 'wa_charter' runs the generic engine. */
  pathway?: string | null
  /** Pathway config for the generic engine; defaults to getStateConfig(pathway). */
  config?: StateConfig
  profile: SchoolProfile
  positions: StaffingPosition[]
  projections: BudgetProjection[]
  /** WA engine assumptions (the generic engine reads its rates from the pathway config). */
  assumptions: FinancialAssumptions
  /** Year-1 starting cash: computeCarryForward(profile). */
  preOpenCash: number
  gradeExpansionPlan?: GradeExpansionEntry[]
  allPositions?: StaffingPosition[]
  startupFunding?: StartupFundingSource[] | null
}

/** Run the pathway's 5-year engine: computeMultiYearDetailed (WA) or computeGenericProjections. */
export function runProjections(i: ProjectionInputs): MultiYearDetailedRow[] {
  const config = i.config ?? getStateConfig(i.pathway)
  return config.pathway === 'wa_charter'
    ? computeMultiYearDetailed(i.profile, i.positions, i.projections, i.assumptions, i.preOpenCash, i.gradeExpansionPlan, i.allPositions, i.startupFunding)
    : computeGenericProjections(i.profile, i.positions, i.projections, config, i.preOpenCash, i.gradeExpansionPlan, i.allPositions, i.startupFunding)
}

export interface EnrollmentSensitivity {
  fillRate: number
  baseEnrollment: number
  /** Year-1 enrollment at the reduced fill rate (from the re-run engine row). */
  enrollment: number
  baseTotalRevenue: number
  /** Year-1 total revenue at the reduced fill rate. */
  totalRevenue: number
  /** Held at the base Year-1 engine total: staffing and contracts are committed before enrollment settles. */
  totalExpenses: number
  baseNetPosition: number
  netPosition: number
  baseDaysOfCash: number
  /** Year-1 days of cash at the reduced fill rate, computed like the FPF scorecard's. */
  daysOfCash: number
}

/**
 * Year-1 enrollment stress test: re-run the engine with every enrollment target (and every
 * grade-expansion section) scaled down to fillRate, take that revenue, and hold expenses
 * at the base Year-1 total.
 */
export function computeEnrollmentSensitivity(inputs: ProjectionInputs, fillRate: number = 0.9): EnrollmentSensitivity {
  const base = runProjections(inputs)[0]
  const p = inputs.profile
  const scale = (n: number | null | undefined) => Math.floor((n || 0) * fillRate)
  const profile: SchoolProfile = {
    ...p,
    target_enrollment_y1: scale(p.target_enrollment_y1),
    target_enrollment_y2: scale(p.target_enrollment_y2),
    target_enrollment_y3: scale(p.target_enrollment_y3),
    target_enrollment_y4: scale(p.target_enrollment_y4),
    target_enrollment_y5: scale(p.target_enrollment_y5 || p.target_enrollment_y4),
  }
  const gradeExpansionPlan = inputs.gradeExpansionPlan?.map((e) => ({ ...e, students_per_section: scale(e.students_per_section) }))
  const reduced = runProjections({ ...inputs, profile, gradeExpansionPlan })[0]
  const depreciation = base.operations.depreciation ?? 0
  const netPosition = reduced.revenue.total - base.totalExpenses
  return {
    fillRate,
    baseEnrollment: base.enrollment,
    enrollment: reduced.enrollment,
    baseTotalRevenue: base.revenue.total,
    totalRevenue: reduced.revenue.total,
    totalExpenses: base.totalExpenses,
    baseNetPosition: base.net,
    netPosition,
    baseDaysOfCash: base.reserveDays,
    daysOfCash: computeDaysOfCash(inputs.preOpenCash + netPosition + depreciation, base.totalExpenses, depreciation),
  }
}

/**
 * Generic Financial Health Scorecard — replaces FPF for non-WA pathways.
 */
export interface GenericHealthMeasure {
  name: string
  values: { year: number; value: number; formatted: string; status: 'green' | 'yellow' | 'red' }[]
  healthy: string
  watch: string
  concern: string
  applicable: boolean
}

export interface GenericHealthScorecard {
  measures: GenericHealthMeasure[]
  overallStatus: 'green' | 'yellow' | 'red'
  overallMessage: string
}

/** R-HEALTH-01: healthy/watch/concern display labels come from the shared band. */
function genericLabels(band: HealthBand): { healthy: string; watch: string; concern: string } {
  return { healthy: band.target, watch: band.approachingRange, concern: band.concern }
}

export function computeGenericHealthScorecard(
  multiYear: MultiYearDetailedRow[],
  startingCash: number,
  config: StateConfig,
  tuitionRate?: number,
  financialAidPct?: number,
): GenericHealthScorecard {
  const isTuition = config.revenue_model === 'tuition'
  const measures: GenericHealthMeasure[] = []

  // 1. Reserve Days
  measures.push({
    name: 'Reserve Days (Cash on Hand)',
    ...genericLabels(getDaysOfCashBand(1, 'generic')),
    applicable: true,
    values: multiYear.map(r => ({
      year: r.year,
      value: r.reserveDays,
      formatted: `${r.reserveDays} days`,
      status: toGenericColor(classify(r.reserveDays, getDaysOfCashBand(r.year, 'generic'))),
    })),
  })

  // 2. Personnel % of Revenue
  measures.push({
    name: 'Personnel % of Revenue',
    ...genericLabels(getGenericPersonnelBand()),
    applicable: true,
    values: multiYear.map(r => {
      const pct = personnelPctOfRevenue(r)
      return {
        year: r.year, value: pct, formatted: `${pct.toFixed(1)}%`,
        status: toGenericColor(classify(pct, getGenericPersonnelBand())),
      }
    }),
  })

  // 3. Total Margin
  measures.push({
    name: 'Total Margin (Net / Revenue)',
    ...genericLabels(getTotalMarginBand(1, 'generic')),
    applicable: true,
    values: multiYear.map(r => {
      const margin = totalMarginPct(r, config.pathway)
      return {
        year: r.year, value: margin, formatted: `${margin.toFixed(1)}%`,
        status: toGenericColor(classify(margin, getTotalMarginBand(r.year, 'generic'))),
      }
    }),
  })

  // 4. Break-Even Enrollment (as % of projected)
  measures.push({
    name: 'Break-Even Enrollment',
    ...genericLabels(getBreakEvenPctBand()),
    applicable: true,
    values: multiYear.map(r => {
      const perPupilRev = r.enrollment > 0 ? r.revenue.operatingRevenue / r.enrollment : 0
      const breakEven = perPupilRev > 0 ? r.totalExpenses / perPupilRev : 0
      const pct = r.enrollment > 0 ? (breakEven / r.enrollment) * 100 : 0
      return {
        year: r.year, value: pct, formatted: `${pct.toFixed(0)}%`,
        status: toGenericColor(classify(pct, getBreakEvenPctBand())),
      }
    }),
  })

  // 5. Current Ratio (simplified: cumulative cash / annual expenses * rough current liabilities)
  measures.push({
    name: 'Current Ratio',
    ...genericLabels(getCurrentRatioBand(1, 'generic')),
    applicable: true,
    values: multiYear.map(r => {
      // Approximate: current assets ≈ cumulative cash; current liabilities ≈ 2 months of expenses
      const currentLiabilities = r.totalExpenses / 6
      const ratio = currentLiabilities > 0 ? r.cumulativeNet / currentLiabilities : 0
      return {
        year: r.year, value: ratio, formatted: ratio.toFixed(2),
        status: toGenericColor(classify(ratio, getCurrentRatioBand(r.year, 'generic'))),
      }
    }),
  })

  // 6. Financial Aid as % of Tuition (private/micro only)
  if (isTuition && tuitionRate && tuitionRate > 0) {
    const aidPct = (financialAidPct || 0) * 100
    measures.push({
      name: 'Financial Aid % of Tuition',
      ...genericLabels(getFinancialAidPctBand()),
      applicable: true,
      values: multiYear.map(r => ({
        year: r.year, value: aidPct, formatted: `${aidPct.toFixed(0)}%`,
        status: toGenericColor(classify(aidPct, getFinancialAidPctBand())),
      })),
    })
  }

  // Overall status
  const yearStatuses = multiYear.map((_, i) => {
    const worst = measures
      .filter(m => m.applicable)
      .map(m => m.values[i]?.status || 'green')
      .reduce((w, s) => s === 'red' ? 'red' : s === 'yellow' && w !== 'red' ? 'yellow' : w, 'green' as 'green' | 'yellow' | 'red')
    return worst
  })
  const overallStatus = yearStatuses.includes('red') ? 'red' : yearStatuses.includes('yellow') ? 'yellow' : 'green'
  const overallMessage = overallStatus === 'green'
    ? 'Your financial model meets all health benchmarks across 5 years.'
    : overallStatus === 'yellow'
    ? 'Some metrics are in the watch range — review before finalizing your plan.'
    : 'Critical metrics need attention — address before proceeding.'

  return { measures, overallStatus, overallMessage }
}
